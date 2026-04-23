/**
 * LocalDrop — Security Module
 * PIN generation, JWT token management, session tracking
 */
import jwt from 'jsonwebtoken'
import { randomBytes, randomInt } from 'crypto'
import { join } from 'path'
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { TokenPayload, DeviceInfo } from '../../../shared/types'

// ── JWT Secret — persistent ข้าม restart ──────
function loadOrCreateSecret(): string {
  const secretPath = join(app.getPath('userData'), '.jwt-secret')
  try {
    if (existsSync(secretPath)) {
      return readFileSync(secretPath, 'utf-8').trim()
    }
  } catch {}
  const secret = randomBytes(32).toString('hex')
  try {
    writeFileSync(secretPath, secret, 'utf-8')
  } catch (err) {
    console.error('[Security] Failed to save JWT secret:', err)
  }
  return secret
}

const JWT_SECRET = loadOrCreateSecret()
const TOKEN_EXPIRY = '24h'

// Active sessions
const sessions = new Map<string, DeviceInfo>()

// Current PIN (6 digits)
let currentPin: string = generatePin()

/** Generate a random 6-digit PIN */
export function generatePin(): string {
  return String(randomInt(100000, 999999))
}

/** Get current PIN */
export function getPin(): string {
  return currentPin
}

/** Regenerate PIN and return new one */
export function refreshPin(): string {
  currentPin = generatePin()
  console.log('[Security] PIN refreshed')
  return currentPin
}

/** Validate PIN attempt */
export function validatePin(attempt: string): boolean {
  return attempt === currentPin
}

// ── Rate Limiting ──────────────────────────────

interface RateLimit {
  attempts: number
  lastAttempt: number
}

const rateLimits = new Map<string, RateLimit>()
const MAX_ATTEMPTS = 5
const RATE_WINDOW_MS = 60 * 1000 // 1 minute

export function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const limit = rateLimits.get(ip)

  if (!limit || now - limit.lastAttempt > RATE_WINDOW_MS) {
    rateLimits.set(ip, { attempts: 1, lastAttempt: now })
    return true
  }

  if (limit.attempts >= MAX_ATTEMPTS) {
    return false
  }

  limit.attempts++
  limit.lastAttempt = now
  return true
}

// ── JWT Token ──────────────────────────────────

/** Create JWT token for a paired device */
export function createToken(deviceId: string, deviceName: string, platform: string): string {
  const payload: Omit<TokenPayload, 'iat' | 'exp'> = {
    deviceId,
    deviceName,
    platform,
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY })
}

/** Verify and decode JWT token */
export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload
  } catch {
    return null
  }
}

// ── Session Management ─────────────────────────

export function addSession(device: DeviceInfo): void {
  sessions.set(device.id, device)
  console.log(`[Security] Device connected: ${device.name} (${device.ip})`)
}

export function removeSession(deviceId: string): DeviceInfo | undefined {
  const device = sessions.get(deviceId)
  sessions.delete(deviceId)
  if (device) {
    console.log(`[Security] Device disconnected: ${device.name}`)
  }
  return device
}

export function getSession(deviceId: string): DeviceInfo | undefined {
  return sessions.get(deviceId)
}

export function getAllSessions(): DeviceInfo[] {
  return Array.from(sessions.values())
}

export function getSessionCount(): number {
  return sessions.size
}

// ── LAN IP Check ───────────────────────────────

export function isPrivateIP(ip: string): boolean {
  // Handle IPv6 mapped IPv4
  const cleanIp = ip.replace(/^::ffff:/, '')

  const parts = cleanIp.split('.').map(Number)
  if (parts.length !== 4) return cleanIp === '::1' || cleanIp === '127.0.0.1'

  // 10.0.0.0/8
  if (parts[0] === 10) return true
  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true
  // localhost
  if (parts[0] === 127) return true

  return false
}
