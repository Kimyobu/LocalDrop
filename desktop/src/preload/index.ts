/**
 * LocalDrop — Preload Script
 * Exposes safe IPC APIs to the renderer process
 */
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom API for LocalDrop
const localDropAPI = {
  // Server status
  getStatus: () => ipcRenderer.invoke('get-status'),
  getDevices: () => ipcRenderer.invoke('get-devices'),
  getFiles: (page?: number, pageSize?: number) =>
    ipcRenderer.invoke('get-files', page, pageSize),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke('update-settings', settings),

  // PIN
  refreshPin: () => ipcRenderer.invoke('refresh-pin'),

  // QR
  getQRData: () => ipcRenderer.invoke('get-qr-data'),

  // Storage
  openStorageFolder: () => ipcRenderer.invoke('open-storage-folder'),
  openFile: (fileId: string) => ipcRenderer.invoke('open-file', fileId),

  // Upload from desktop
  uploadFiles: (filePaths: string[]) => ipcRenderer.invoke('upload-files', filePaths),
  pickFiles: () => ipcRenderer.invoke('pick-files'),

  // Event listeners
  onFileUploaded: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('file-uploaded', handler)
    return () => ipcRenderer.removeListener('file-uploaded', handler)
  },
  onFileDeleted: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('file-deleted', handler)
    return () => ipcRenderer.removeListener('file-deleted', handler)
  },
  onDeviceConnected: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('device-connected', handler)
    return () => ipcRenderer.removeListener('device-connected', handler)
  },
  onDeviceDisconnected: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('device-disconnected', handler)
    return () => ipcRenderer.removeListener('device-disconnected', handler)
  },
}

// Expose to renderer
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('localDrop', localDropAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  ;(window as any).electron = electronAPI
  ;(window as any).localDrop = localDropAPI
}
