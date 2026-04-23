// mobile/src/services/discovery.ts

const DISCOVERY_PORT = 8700
const SCAN_TIMEOUT = 6000

export interface DiscoveredServer {
  ip: string
  port: number
  name: string
}

// ดึง subnet จาก IP ของมือถือ เช่น 192.168.0.x → scan 192.168.0.1-254
function getSubnet(ip: string): string {
  return ip.split('.').slice(0, 3).join('.')
}

// ยิง /api/v1/status ไปแต่ละ IP พร้อมกัน
async function probeHost(ip: string, port: number): Promise<DiscoveredServer | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 800)
  try {
    const res = await fetch(`http://${ip}:${port}/api/v1/status`, {
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data?.version) {
      return { ip, port, name: data.name || ip }
    }
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function discoverServer(): Promise<DiscoveredServer> {
  // หา IP ของมือถือเอง
  const Network = await import('expo-network')
  const localIp = await Network.getIpAddressAsync()

  if (!localIp || localIp === '0.0.0.0') {
    throw new Error('ไม่สามารถอ่าน IP ของอุปกรณ์ได้ — กรุณาเชื่อมต่อ WiFi ก่อน')
  }

  const subnet = getSubnet(localIp)

  // สร้าง probe requests พร้อมกัน 254 host แบ่งเป็น batch ละ 30
  const hosts = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`)
  const BATCH_SIZE = 30

  for (let i = 0; i < hosts.length; i += BATCH_SIZE) {
    const batch = hosts.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(batch.map(ip => probeHost(ip, DISCOVERY_PORT)))
    const found = results.find(r => r !== null)
    if (found) return found
  }

  throw new Error('ไม่พบ LocalDrop บนเครือข่ายนี้')
}

