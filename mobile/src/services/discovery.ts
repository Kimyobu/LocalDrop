// mobile/src/services/discovery.ts

const HTTP_PORT = 8700
const PROBE_TIMEOUT_MS = 2000  // เพิ่มเป็น 2s สำหรับ APK จริง (network latency สูงกว่า)
const BATCH_SIZE = 15          // ลดจาก 20 → 15 กัน Android concurrent connection limit

export interface DiscoveredServer {
  ip: string
  port: number
  name: string
}

function getSubnet(ip: string): string {
  return ip.split('.').slice(0, 3).join('.')
}

async function probeHost(ip: string, port: number): Promise<DiscoveredServer | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const url = `http://${ip}:${port}/api/v1/status`
    console.log(`[Discovery] Probing: ${url}`)
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Cache-Control': 'no-cache' },
    })
    if (!res.ok) {
      console.log(`[Discovery] ${ip} responded with ${res.status}`)
      return null
    }
    const data = await res.json()
    if (data?.version) {
      console.log(`[Discovery] ✅ Found server at ${ip}:${port} — ${data.name}`)
      return { ip, port, name: data.name || ip }
    }
    return null
  } catch (err: any) {
    // เฉพาะ log error ที่ไม่ใช่ timeout (ลดเสียง)
    if (err.name !== 'AbortError') {
      console.log(`[Discovery] ${ip} error: ${err.message}`)
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Direct probe — ใช้สำหรับทดสอบ IP ตรงๆ
 * มี timeout ยาวขึ้นและ retry 1 ครั้ง
 */
export async function probeDirectIP(ip: string, port: number = HTTP_PORT): Promise<DiscoveredServer | null> {
  console.log(`[Discovery] Direct probe: ${ip}:${port}`)

  // ลองครั้งแรก
  const result = await probeHost(ip, port)
  if (result) return result

  // Retry อีก 1 ครั้ง (delay 500ms)
  console.log(`[Discovery] Retry direct probe: ${ip}:${port}`)
  await new Promise(r => setTimeout(r, 500))
  return probeHost(ip, port)
}

export async function discoverServer(): Promise<DiscoveredServer> {
  const Network = await import('expo-network')

  // ตรวจ WiFi ก่อน — บน APK จำเป็นมาก
  const networkState = await Network.getNetworkStateAsync()
  console.log(`[Discovery] Network state:`, JSON.stringify(networkState))

  if (!networkState.isConnected) {
    throw new Error('ไม่มีการเชื่อมต่อเครือข่าย')
  }
  if (networkState.type !== Network.NetworkStateType.WIFI) {
    throw new Error('กรุณาเชื่อมต่อ WiFi ก่อนใช้งาน (ไม่รองรับ Mobile Data)')
  }

  // รอ IP ให้พร้อม — บน APK cold start อาจได้ 0.0.0.0 ก่อน
  let localIp = ''
  for (let attempt = 0; attempt < 8; attempt++) {
    localIp = await Network.getIpAddressAsync()
    console.log(`[Discovery] IP attempt ${attempt + 1}: ${localIp}`)
    if (localIp && localIp !== '0.0.0.0' && localIp !== '127.0.0.1') break
    await new Promise(r => setTimeout(r, 800))
  }

  if (!localIp || localIp === '0.0.0.0') {
    throw new Error('ไม่สามารถอ่าน IP ของอุปกรณ์ได้ — ลองปิดเปิด WiFi แล้วลองใหม่')
  }

  const subnet = getSubnet(localIp)
  console.log(`[Discovery] Local IP: ${localIp}, scanning subnet: ${subnet}.x`)

  // ทดสอบ HTTP fetch ได้ไหมก่อน — ถ้า cleartext ถูก block จะ fail ทันที
  try {
    const testController = new AbortController()
    const testTimer = setTimeout(() => testController.abort(), 3000)
    await fetch(`http://${subnet}.1:${HTTP_PORT}/api/v1/status`, {
      method: 'GET',
      signal: testController.signal,
    }).catch(() => {}) // expected to fail — แค่ทดสอบว่า HTTP ไม่ถูก block
    clearTimeout(testTimer)
    console.log('[Discovery] HTTP cleartext test passed')
  } catch (err: any) {
    if (err.message?.includes('Cleartext') || err.message?.includes('CLEARTEXT')) {
      throw new Error('Android บล็อก HTTP — กรุณา rebuild APK (cleartext traffic ยังไม่ถูกเปิด)')
    }
    console.log('[Discovery] HTTP test completed (may have timed out, which is expected)')
  }

  // 1. Probe common gateway/server IPs ก่อน (เร็วที่สุด)
  const commonSuffixes = [1, 2, 100, 101, 102, 105, 110, 150, 200, 254]
  // ดึง suffix ของมือถือเองด้วย ±5 (desktop มักอยู่ใกล้กัน)
  const ownSuffix = parseInt(localIp.split('.')[3])
  const nearSuffixes = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]
    .map(d => ownSuffix + d)
    .filter(s => s > 0 && s < 255 && !commonSuffixes.includes(s))

  const quickTargets = [...new Set([...commonSuffixes, ...nearSuffixes])]
    .map(s => `${subnet}.${s}`)

  console.log(`[Discovery] Quick scan: ${quickTargets.length} targets`)
  const quickResults = await Promise.all(quickTargets.map(ip => probeHost(ip, HTTP_PORT)))
  const quickFound = quickResults.find(r => r !== null)
  if (quickFound) {
    console.log(`[Discovery] Found quickly: ${quickFound.ip}`)
    return quickFound
  }

  // 2. Full scan แบบ batch — ข้าม IP ที่ probe ไปแล้ว
  const scanned = new Set(quickTargets)
  const allHosts = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`)
    .filter(ip => !scanned.has(ip))

  console.log(`[Discovery] Full scan: ${allHosts.length} remaining hosts`)
  for (let i = 0; i < allHosts.length; i += BATCH_SIZE) {
    const batch = allHosts.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(batch.map(ip => probeHost(ip, HTTP_PORT)))
    const found = results.find(r => r !== null)
    if (found) {
      console.log(`[Discovery] Found in full scan: ${found.ip}`)
      return found
    }
  }

  throw new Error('ไม่พบ LocalDrop บนเครือข่ายนี้\nตรวจสอบว่า Desktop app เปิดอยู่และอยู่ WiFi เดียวกัน')
}