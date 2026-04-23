/**
 * LocalDrop — WebSocket Hub
 * Real-time event broadcasting to connected clients
 */
import { WebSocketServer, WebSocket } from 'ws'
import type { Server as HTTPServer } from 'http'
import { verifyToken } from './security'
import type { WSMessage, WSEventType } from '../../../shared/types'

interface WSClient {
  ws: WebSocket
  deviceId: string
  deviceName: string
  isAlive: boolean
}

let wss: WebSocketServer | null = null
const clients: Map<string, WSClient> = new Map()

let onDeviceDisconnectCb: ((deviceId: string) => void) | null = null

export function setOnDeviceDisconnect(cb: (deviceId: string) => void) {
  onDeviceDisconnectCb = cb
}

/** Initialize WebSocket server on existing HTTP server */
export function initWebSocket(server: HTTPServer): void {
  wss = new WebSocketServer({ server, path: '/api/v1/ws' })

  wss.on('connection', (ws, req) => {
    // Extract token from query string
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    const token = url.searchParams.get('token')

    if (!token) {
      ws.close(4001, 'Missing token')
      return
    }

    const payload = verifyToken(token)
    if (!payload) {
      ws.close(4002, 'Invalid token')
      return
    }

    const client: WSClient = {
      ws,
      deviceId: payload.deviceId,
      deviceName: payload.deviceName,
      isAlive: true,
    }

    clients.set(payload.deviceId, client)
    console.log(`[WS] Client connected: ${payload.deviceName} (${clients.size} total)`)

    // Send welcome message
    sendTo(ws, 'device_connected', {
      deviceId: payload.deviceId,
      message: 'Connected to LocalDrop',
    })

    ws.on('close', () => {
      clients.delete(payload.deviceId)
      console.log(`[WS] Client disconnected: ${payload.deviceName} (${clients.size} total)`)

      if (onDeviceDisconnectCb) {
        onDeviceDisconnectCb(payload.deviceId)
      }
    })

    ws.on('error', (err) => {
      console.error(`[WS] Error from ${payload.deviceName}:`, err.message)
    })

    // Handle ping/pong for keepalive
    ws.on('pong', () => {
      if (clients.has(payload.deviceId)) {
        clients.get(payload.deviceId)!.isAlive = true
      }
    })
  })

  // Heartbeat interval — check clients every 5s for fast detection
  setInterval(() => {
    for (const [id, client] of clients) {
      if (!client.isAlive || client.ws.readyState !== WebSocket.OPEN) {
        client.ws.terminate()
        clients.delete(id)
        if (onDeviceDisconnectCb) {
          onDeviceDisconnectCb(id)
        }
      } else {
        client.isAlive = false
        client.ws.ping()
      }
    }
  }, 5000)

  console.log('[WS] WebSocket server initialized')
}

/** Send message to a specific WebSocket */
function sendTo(ws: WebSocket, event: WSEventType, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    const msg: WSMessage = {
      event,
      data,
      timestamp: new Date().toISOString(),
    }
    ws.send(JSON.stringify(msg))
  }
}

/** Broadcast event to all connected clients */
export function broadcast(event: WSEventType, data: unknown, excludeDeviceId?: string): void {
  const msg: WSMessage = {
    event,
    data,
    timestamp: new Date().toISOString(),
  }
  const payload = JSON.stringify(msg)

  for (const [id, client] of clients) {
    if (id !== excludeDeviceId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload)
    }
  }
}

/** Get count of connected WebSocket clients */
export function getWSClientCount(): number {
  return clients.size
}

/** Shutdown WebSocket server */
export function shutdownWebSocket(): void {
  if (wss) {
    for (const client of clients.values()) {
      client.ws.close(1001, 'Server shutting down')
    }
    clients.clear()
    wss.close()
    console.log('[WS] WebSocket server shut down')
  }
}
