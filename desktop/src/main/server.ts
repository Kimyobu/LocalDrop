/**
 * LocalDrop — Express HTTP Server
 * REST API for file operations, pairing, and status
 */
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { createServer, type Server as HTTPServer } from 'http'
import { v4 as uuidv4 } from 'uuid'
import QRCode from 'qrcode'
import os from 'os'

import {
  getPin, refreshPin, validatePin, checkRateLimit,
  createToken, verifyToken, addSession, removeSession,
  getAllSessions, getSessionCount, isPrivateIP,
} from './security'

import {
  initStorage, saveFile, listFiles, getFileInfo,
  getFilePath, deleteFile, getStorageUsed, getFileCount,
  isAllowedExtension, isWithinSizeLimit,
} from './storage'

import { initWebSocket, broadcast, setOnDeviceDisconnect } from './websocket'
import { getPrimaryIP } from './discovery'
import { generateThumbnail } from './thumbnail'
import type { AppSettings, PairResponse, DeviceInfo } from '../../../shared/types'

let httpServer: HTTPServer | null = null
let settings: AppSettings

// ── Filename decode ──────────────────────────────────────────────────────────
/**
 * แก้ชื่อไฟล์ภาษาไทยที่ถูก encode มาหลายรูปแบบ:
 * 1. URL-encoded:  %E0%B8%9A%E0%B8%97... → บทพูด
 * 2. Latin1/UTF-8 misread: Multer อ่าน UTF-8 filename เป็น Latin1
 * 3. ปกติ: ใช้ค่าเดิม
 */
function decodeFilename(raw: string): string {
  // ลอง latin1 → utf8 ก่อน (กรณี Multer misread)
  const fromLatin1 = Buffer.from(raw, 'latin1').toString('utf8')

  // ถ้า fromLatin1 มี multi-byte Thai แสดงว่า decode สำเร็จ
  if (/[\u0E00-\u0E7F]/.test(fromLatin1)) return fromLatin1

  // ถ้า raw มี % ลอง URL-decode
  if (raw.includes('%')) {
    try {
      const decoded = decodeURIComponent(raw)
      if (/[\u0E00-\u0E7F]/.test(decoded)) return decoded
    } catch {
      // ignore — ใช้ค่าเดิม
    }
  }

  return raw
}

// ── Multer (lazy init เพื่อใช้ settings.maxFileSize) ────────────────────────
function createUploadMiddleware() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: (settings?.maxFileSize ?? 500) * 1024 * 1024 },
  }).array('files', 20)
}

// ── Auth middleware ──────────────────────────────────────────────────────────
const authMiddleware: express.RequestHandler = (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || ''
  if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') {
    ; (req as any).deviceId = 'desktop'
      ; (req as any).deviceName = 'Desktop'
    return next()
  }

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (req.query.token as string) || ''

  if (!token) return res.status(401).json({ error: 'Missing authorization token' })

  const payload = verifyToken(token)
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })

    ; (req as any).deviceId = payload.deviceId
    ; (req as any).deviceName = payload.deviceName
  next()
}

// ── Background thumbnail queue ───────────────────────────────────────────────
// ใช้ concurrency 3 แทน sequential เต็มรูปแบบ
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!
      await fn(item).catch(() => { })
    }
  })
  await Promise.all(workers)
}

// ── App factory ──────────────────────────────────────────────────────────────
function createApp(): express.Application {
  const app = express()
  app.use(cors())
  app.use(express.json())

  // LAN-only guard
  app.use('/api', (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || ''
    if (!isPrivateIP(ip)) {
      return res.status(403).json({ error: 'Access restricted to local network' })
    }
    next()
  })

  // ── Status ─────────────────────────────────────────────────────────────────
  app.get('/api/v1/status', (_req, res) => {
    res.json({
      name: os.hostname(),
      version: '1.0.0',
      port: settings.port,
      pinRequired: settings.pinMode,
      deviceCount: getSessionCount(),
      fileCount: getFileCount(),
      storageUsed: getStorageUsed(),
    })
  })

  // ── QR Code ────────────────────────────────────────────────────────────────
  app.get('/api/v1/qrcode', async (_req, res) => {
    try {
      const ip = getPrimaryIP()
      const data = JSON.stringify({
        service: 'localdrop',
        ip,
        port: settings.port,
        pin: settings.pinMode ? getPin() : undefined,
      })
      const qr = await QRCode.toDataURL(data, { width: 300, margin: 2 })
      res.json({ qrcode: qr, ip, port: settings.port })
    } catch {
      res.status(500).json({ error: 'Failed to generate QR code' })
    }
  })

  // ── Pairing ────────────────────────────────────────────────────────────────
  app.post('/api/v1/pair', (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || ''

    if (!checkRateLimit(ip)) {
      return res.status(429).json({
        success: false,
        error: 'Too many attempts. Try again in 1 minute.',
      } satisfies PairResponse)
    }

    const { pin, deviceName, platform } = req.body

    if (settings.pinMode && (!pin || !validatePin(pin))) {
      return res.status(401).json({ success: false, error: 'Invalid PIN' } satisfies PairResponse)
    }

    const deviceId = uuidv4()
    const token = createToken(deviceId, deviceName || 'Unknown', platform || 'mobile')
    const cleanIp = ip.replace(/^::ffff:/, '')

    // ล้าง session เก่าจาก IP เดิมก่อน
    for (const session of getAllSessions()) {
      if (session.ip === cleanIp) handleDeviceDisconnect(session.id)
    }

    const device: DeviceInfo = {
      id: deviceId,
      name: deviceName || 'Unknown',
      ip: cleanIp,
      port: 0,
      platform: platform || 'mobile',
      connectedAt: new Date().toISOString(),
    }

    addSession(device)
    broadcast('device_connected', device)
    notifyRenderer('device-connected', device)

    res.json({ success: true, token, device } satisfies PairResponse)
  })

  // ── Unpair ─────────────────────────────────────────────────────────────────
  app.post('/api/v1/unpair', authMiddleware, (req, res) => {
    handleDeviceDisconnect((req as any).deviceId)
    res.json({ success: true })
  })

  // ── File List ──────────────────────────────────────────────────────────────
  app.get('/api/v1/files', authMiddleware, async (req, res) => {
    const page = parseInt(req.query.page as string) || 1
    const pageSize = parseInt(req.query.pageSize as string) || 50
    const type = req.query.type as string | undefined
    res.json(await listFiles(page, pageSize, type))
  })

  // ── File Upload ────────────────────────────────────────────────────────────
  app.post('/api/v1/files', authMiddleware, (req, res, next) => {
    // สร้าง multer instance ตอน request เข้ามา เพื่อให้ใช้ settings.maxFileSize ที่ถูกต้อง
    createUploadMiddleware()(req, res, next)
  }, async (req, res) => {
    const files = req.files as Express.Multer.File[]
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, errors: ['No files provided'] })
    }

    const deviceName = (req as any).deviceName || 'Unknown'
    const saved = []
    const errors: string[] = []

    for (const file of files) {
      // decode ชื่อไฟล์ภาษาไทย
      const originalName = decodeFilename(file.originalname)

      if (!isAllowedExtension(originalName, settings.allowedExtensions)) {
        errors.push(`${originalName}: File type not allowed`)
        continue
      }

      if (!isWithinSizeLimit(file.size, settings.maxFileSize)) {
        errors.push(`${originalName}: File too large`)
        continue
      }

      try {
        const info = await saveFile(file.buffer, originalName, file.mimetype, deviceName)
        saved.push(info)

        // Background thumbnail — ไม่ block response
        const filePath = getFilePath(info.id)
        if (filePath) {
          const decodedPath = filePath.includes('%') ? decodeURIComponent(filePath) : filePath
          generateThumbnail(decodedPath, info.mimeType, info.id).catch(() => { })
        }

        broadcast('file_uploaded', info)
        notifyRenderer('file-uploaded', info)
      } catch {
        errors.push(`${originalName}: Upload failed`)
      }
    }

    res.json({ success: true, files: saved, errors: errors.length > 0 ? errors : undefined })
  })

  // ── File Info ──────────────────────────────────────────────────────────────
  app.get('/api/v1/files/:id', authMiddleware, (req, res) => {
    const info = getFileInfo(req.params.id)
    if (!info) return res.status(404).json({ error: 'File not found' })
    res.json(info)
  })

  // ── File Download ──────────────────────────────────────────────────────────
  app.get('/api/v1/files/:id/download', authMiddleware, (req, res) => {
    const info = getFileInfo(req.params.id)
    if (!info) return res.status(404).json({ error: 'File not found' })

    const filePath = getFilePath(req.params.id)
    if (!filePath) return res.status(404).json({ error: 'File not found on disk' })

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(info.originalName)}`)
    res.setHeader('Content-Type', info.mimeType)
    res.setHeader('Content-Length', info.size)
    res.sendFile(filePath)
  })

  // ── File Thumbnail ─────────────────────────────────────────────────────────
  app.get('/api/v1/files/:id/thumbnail', authMiddleware, async (req, res) => {
    const info = getFileInfo(req.params.id)
    if (!info) return res.status(404).json({ error: 'File not found' })

    const filePath = getFilePath(req.params.id)
    if (!filePath) return res.status(404).json({ error: 'File not found on disk' })

    const decodedPath = filePath.includes('%') ? decodeURIComponent(filePath) : filePath
    const buffer = await generateThumbnail(decodedPath, info.mimeType, req.params.id)
    if (!buffer) return res.status(404).json({ error: 'No thumbnail available' })

    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'public, max-age=31536000')
    res.send(buffer)
  })

  // ── File Delete ────────────────────────────────────────────────────────────
  app.delete('/api/v1/files/:id', authMiddleware, async (req, res) => {
    const info = getFileInfo(req.params.id)
    if (!info) return res.status(404).json({ error: 'File not found' })

    const deleted = await deleteFile(req.params.id)
    if (!deleted) return res.status(500).json({ error: 'Failed to delete file' })

    broadcast('file_deleted', { id: req.params.id, name: info.name })
    notifyRenderer('file-deleted', { id: req.params.id })
    res.json({ success: true })
  })

  // ── Error handler ──────────────────────────────────────────────────────────
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[Server] Error:', err.message)
    if ((err as any).code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large' })
    }
    res.status(500).json({ error: 'Internal server error' })
  })

  return app
}

// ── Renderer IPC ─────────────────────────────────────────────────────────────
let rendererNotifier: ((channel: string, data: unknown) => void) | null = null

export function setRendererNotifier(fn: (channel: string, data: unknown) => void): void {
  rendererNotifier = fn
}

function notifyRenderer(channel: string, data: unknown): void {
  rendererNotifier?.(channel, data)
}

export function handleDeviceDisconnect(deviceId: string) {
  const device = removeSession(deviceId)
  if (device) {
    broadcast('device_disconnected', device)
    notifyRenderer('device-disconnected', device)
  }
}

// ── Server Lifecycle ──────────────────────────────────────────────────────────
export async function startServer(appSettings: AppSettings): Promise<HTTPServer> {
  settings = appSettings
  await initStorage(settings.storagePath)

  const app = createApp()
  httpServer = createServer(app)
  initWebSocket(httpServer)
  setOnDeviceDisconnect(handleDeviceDisconnect)

  httpServer.listen(settings.port, '0.0.0.0', () => {
    console.log(`[Server] Running on port ${settings.port}`)
    console.log(`[Server] PIN mode: ${settings.pinMode ? `ON (${getPin()})` : 'OFF'}`)
  })

  // Background thumbnail generation — concurrency 3 แทน sequential
  setTimeout(async () => {
    const { files } = await listFiles(1, 1000)
    console.log(`[Server] Generating thumbnails for ${files.length} files...`)

    await runWithConcurrency(files, 3, async (f) => {
      const filePath = getFilePath(f.id)
      if (!filePath) return
      const decodedPath = filePath.includes('%') ? decodeURIComponent(filePath) : filePath
      await generateThumbnail(decodedPath, f.mimeType, f.id)
    })

    console.log('[Server] Thumbnail generation complete.')
  }, 5000)

  return httpServer
}

export function stopServer(): void {
  if (httpServer) {
    httpServer.close()
    httpServer = null
    console.log('[Server] Stopped')
  }
}