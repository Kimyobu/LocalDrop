/**
 * LocalDrop — Shared Types
 * ใช้ร่วมระหว่าง Desktop (Electron) และ Mobile (React Native)
 */

// ────────────────────────────────────────
// Device & Connection
// ────────────────────────────────────────

export interface DeviceInfo {
  id: string
  name: string
  ip: string
  port: number
  platform: 'desktop' | 'mobile'
  connectedAt?: string
}

export interface ServerStatus {
  name: string
  version: string
  port: number
  pinRequired: boolean
  deviceCount: number
  fileCount: number
  storageUsed: number // bytes
}

// ────────────────────────────────────────
// Discovery (UDP Broadcast)
// ────────────────────────────────────────

export interface DiscoveryBeacon {
  service: 'localdrop'
  version: string
  name: string
  port: number
  pinRequired: boolean
}

// ────────────────────────────────────────
// Auth / Pairing
// ────────────────────────────────────────

export interface PairRequest {
  pin?: string // optional for no-pin mode
  deviceName: string
  platform: 'mobile' | 'desktop'
}

export interface PairResponse {
  success: boolean
  token?: string
  device?: DeviceInfo
  error?: string
}

export interface TokenPayload {
  deviceId: string
  deviceName: string
  platform: string
  iat: number
  exp: number
}

// ────────────────────────────────────────
// Files
// ────────────────────────────────────────

export interface FileInfo {
  id: string
  name: string
  originalName: string
  size: number
  mimeType: string
  extension: string
  createdAt: string
  uploadedBy?: string // device name
}

export interface FileListResponse {
  files: FileInfo[]
  total: number
  page: number
  pageSize: number
}

export interface UploadResponse {
  success: boolean
  files: FileInfo[]
  errors?: string[]
}

// ────────────────────────────────────────
// WebSocket Events
// ────────────────────────────────────────

export type WSEventType =
  | 'file_uploaded'
  | 'file_deleted'
  | 'device_connected'
  | 'device_disconnected'
  | 'transfer_progress'

export interface WSMessage {
  event: WSEventType
  data: unknown
  timestamp: string
}

export interface TransferProgress {
  fileId: string
  fileName: string
  percent: number
  bytesTransferred: number
  totalBytes: number
  direction: 'upload' | 'download'
}

// ────────────────────────────────────────
// Settings
// ────────────────────────────────────────

export interface AppSettings {
  port: number
  pinMode: boolean
  maxFileSize: number // bytes
  allowedExtensions: string[]
  storagePath: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  port: 8700,
  pinMode: true,
  maxFileSize: 10 * 1024 * 1024 * 1024, // 10GB
  allowedExtensions: ['*'],
  storagePath: './files',
}
