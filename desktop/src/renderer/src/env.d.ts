/**
 * LocalDrop — Type declarations for preload API
 */

interface LocalDropAPI {
  getStatus: () => Promise<{
    ip: string
    ips: string[]
    port: number
    pin: string
    pinMode: boolean
    deviceCount: number
    fileCount: number
    storageUsed: number
  }>
  getDevices: () => Promise<import('../../../../shared/types').DeviceInfo[]>
  getFiles: (page?: number, pageSize?: number) => Promise<import('../../../../shared/types').FileListResponse>
  getSettings: () => Promise<import('../../../../shared/types').AppSettings>
  updateSettings: (settings: Record<string, unknown>) => Promise<import('../../../../shared/types').AppSettings>
  refreshPin: () => Promise<string>
  getQRData: () => Promise<{ service: string; ip: string; port: number; pin?: string }>
  openStorageFolder: () => Promise<void>
  onFileUploaded: (callback: (data: unknown) => void) => () => void
  onFileDeleted: (callback: (data: unknown) => void) => () => void
  onDeviceConnected: (callback: (data: unknown) => void) => () => void
  onDeviceDisconnected: (callback: (data: unknown) => void) => () => void
}

declare global {
  interface Window {
    localDrop: LocalDropAPI
    electron: unknown
  }
}

export {}
