/**
 * LocalDrop Mobile — API Client
 * HTTP wrapper for communicating with desktop server
 */

let baseUrl = ''
let authToken = ''

export function setServer(ip: string, port: number) {
  baseUrl = `http://${ip}:${port}/api/v1`
}

export function setToken(token: string) {
  authToken = token
}

export function getBaseUrl() { return baseUrl }
export function getToken() { return authToken }
export function isConnected() { return !!baseUrl && !!authToken }

async function request(path: string, options: RequestInit = {}, timeoutMs = 8000) {
  if (!baseUrl) throw new Error('ยังไม่ได้ set server')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
    }
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`
    if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json'

    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    return res
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Timeout — ไม่สามารถเชื่อมต่อ ${baseUrl} ได้`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// ── Status ──────────────────────────────

export async function getStatus() {
  const res = await request('/status', {}, 5000)
  return res.json()
}

// ── Pairing ─────────────────────────────

export async function pair(deviceName: string, pin?: string) {
  const body: any = { deviceName, platform: 'mobile' }
  if (pin) body.pin = pin

  const res = await request('/pair', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (data.success && data.token) {
    authToken = data.token
  }
  return data
}

export async function unpair() {
  await request('/unpair', { method: 'POST' }).catch(() => {})
  authToken = ''
  baseUrl = ''
}

// ── Files ───────────────────────────────

export async function listFiles(page = 1, pageSize = 50) {
  const res = await request(`/files?page=${page}&pageSize=${pageSize}`)
  return res.json()
}

export async function uploadFiles(files: { uri: string; name: string; type: string }[]) {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as any)
  }

  const res = await request('/files', {
    method: 'POST',
    body: formData,
  }, 60000) // 1 minute timeout for uploads
  return res.json()
}

export async function getDownloadUrl(fileId: string) {
  return `${baseUrl}/files/${fileId}/download?token=${authToken}`
}

export function getThumbnailUrl(fileId: string) {
  return `${baseUrl}/files/${fileId}/thumbnail?token=${authToken}`
}

export async function deleteFile(fileId: string) {
  const res = await request(`/files/${fileId}`, { method: 'DELETE' })
  return res.json()
}

// ── WebSocket Live Check ──────────────────────

let ws: WebSocket | null = null

export function connectWebSocket(onMessage?: (event: any) => void) {
  if (!baseUrl || !authToken) return
  
  // Convert http:// to ws://
  const wsUrl = baseUrl.replace(/^http/, 'ws') + `/ws?token=${authToken}`
  
  if (ws) {
    ws.close()
  }
  
  ws = new WebSocket(wsUrl)
  
  ws.onopen = () => {
    console.log('[WS] Mobile connected to server')
  }
  
  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      if (onMessage) onMessage(data)
    } catch {}
  }
  
  ws.onerror = (e) => {
    console.log('[WS] Error:', e)
  }
  
  ws.onclose = () => {
    console.log('[WS] Mobile disconnected from server')
    ws = null
  }
  
  return ws
}

export function disconnectWebSocket() {
  if (ws) {
    ws.close()
    ws = null
  }
}
