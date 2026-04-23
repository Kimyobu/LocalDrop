/**
 * LocalDrop — UDP Discovery Beacon
 * Broadcasts presence on LAN so mobile devices can find us
 */
import dgram from 'dgram'
import os from 'os'
import type { DiscoveryBeacon } from '../../../shared/types'

const DISCOVERY_PORT = 8701
const BROADCAST_INTERVAL = 3000 // 3 seconds

let socket: dgram.Socket | null = null
let intervalId: NodeJS.Timeout | null = null

/** Get all local IPv4 addresses (non-loopback) */
export function getLocalIPs(): string[] {
  const interfaces = os.networkInterfaces()
  const ips: string[] = []

  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name]
    if (!iface) continue

    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal) {
        ips.push(info.address)
      }
    }
  }

  return ips
}

/** Get primary local IP address */
export function getPrimaryIP(): string {
  const ips = getLocalIPs()
  // Prefer 192.168.x.x, then 10.x.x.x, then any
  const preferred = ips.find((ip) => ip.startsWith('192.168.'))
    || ips.find((ip) => ip.startsWith('10.'))
    || ips[0]
  return preferred || '127.0.0.1'
}

/** Get broadcast address from IP */
function getBroadcastAddress(ip: string): string {
  const parts = ip.split('.')
  parts[3] = '255'
  return parts.join('.')
}

/** Start UDP discovery beacon */
export function startDiscovery(
  serverPort: number,
  pinRequired: boolean,
  deviceName?: string
): void {
  if (socket) {
    stopDiscovery()
  }

  socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

  socket.on('error', (err) => {
    console.error('[Discovery] Socket error:', err.message)
    stopDiscovery()
  })

  socket.bind(() => {
    if (!socket) return
    socket.setBroadcast(true)

    const name = deviceName || os.hostname()
    const beacon: DiscoveryBeacon = {
      service: 'localdrop',
      version: '1.0',
      name,
      port: serverPort,
      pinRequired,
    }

    const message = Buffer.from(JSON.stringify(beacon))

    // Broadcast on all interfaces + global broadcast
    const broadcastFn = (): void => {
      const ips = [...getLocalIPs(), '255.255.255.255']
      const sent = new Set<string>()

      for (const ip of ips) {
        const broadcastAddr = ip.includes('255') ? ip : getBroadcastAddress(ip)
        if (sent.has(broadcastAddr)) continue
        sent.add(broadcastAddr)

        socket?.send(message, 0, message.length, DISCOVERY_PORT, broadcastAddr, (err) => {
          if (err) {
            console.error(`[Discovery] Broadcast error on ${broadcastAddr}:`, err.message)
          }
        })
      }
    }

    // Broadcast immediately, then on interval
    broadcastFn()
    intervalId = setInterval(broadcastFn, BROADCAST_INTERVAL)

    console.log(`[Discovery] Beacon started — broadcasting on port ${DISCOVERY_PORT}`)
    console.log(`[Discovery] Server: ${name} at port ${serverPort}`)
  })
}

/** Update beacon data (e.g., when settings change) */
export function updateBeacon(serverPort: number, pinRequired: boolean): void {
  // Restart with new settings
  stopDiscovery()
  startDiscovery(serverPort, pinRequired)
}

/** Stop discovery beacon */
export function stopDiscovery(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
  if (socket) {
    try {
      socket.close()
    } catch {
      // ignore
    }
    socket = null
  }
  console.log('[Discovery] Beacon stopped')
}
