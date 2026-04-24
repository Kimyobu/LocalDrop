/**
 * LocalDrop — Electron Main Process
 * Entry point: creates window, starts server, starts discovery
 */
import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { readFileSync } from 'fs'
import { lookup } from 'mime-types'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

import { loadSettings, saveSettings, ensureStorageDir } from './config'
import { startServer, stopServer, setRendererNotifier } from './server'
import { startDiscovery, stopDiscovery, getPrimaryIP, getLocalIPs } from './discovery'
import { getPin, refreshPin, getAllSessions } from './security'
import { listFiles, getFileCount, getStorageUsed, getFilePath, saveFile, startFileWatcher, stopFileWatcher, setOnExternalFileAdded, setOnExternalFileDeleted, syncExternalFiles } from './storage'
import { generateThumbnail } from './thumbnail'
import { shutdownWebSocket } from './websocket'
import type { AppSettings } from '../../../shared/types'

let mainWindow: BrowserWindow | null = null
let currentSettings: AppSettings

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'LocalDrop',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Load renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── IPC Handlers ──────────────────────────────

function setupIPC(): void {
  // Get server status
  ipcMain.handle('get-status', () => ({
    ip: getPrimaryIP(),
    ips: getLocalIPs(),
    port: currentSettings.port,
    pin: getPin(),
    pinMode: currentSettings.pinMode,
    deviceCount: getAllSessions().length,
    fileCount: getFileCount(),
    storageUsed: getStorageUsed(),
  }))

  // Get connected devices
  ipcMain.handle('get-devices', () => getAllSessions())

  // Get file list
  ipcMain.handle('get-files', async (_event, page?: number, pageSize?: number) => {
    return await listFiles(page || 1, pageSize || 50)
  })

  // Get settings
  ipcMain.handle('get-settings', () => currentSettings)

  // Update settings
  ipcMain.handle('update-settings', (_event, newSettings: Partial<AppSettings>) => {
    currentSettings = { ...currentSettings, ...newSettings }
    saveSettings(currentSettings)

    // Restart discovery with new settings
    stopDiscovery()
    startDiscovery(currentSettings.port, currentSettings.pinMode)

    return currentSettings
  })

  // Refresh PIN
  ipcMain.handle('refresh-pin', () => {
    const newPin = refreshPin()
    // Restart discovery to update pinRequired
    stopDiscovery()
    startDiscovery(currentSettings.port, currentSettings.pinMode)
    return newPin
  })

  // Get QR code data
  ipcMain.handle('get-qr-data', () => ({
    service: 'localdrop',
    ip: getPrimaryIP(),
    port: currentSettings.port,
    pin: currentSettings.pinMode ? getPin() : undefined,
  }))

  // Open storage folder
  ipcMain.handle('open-storage-folder', () => {
    shell.openPath(currentSettings.storagePath)
  })

  // Open specific file in default app
  ipcMain.handle('open-file', async (_event, fileId: string) => {
    const filePath = getFilePath(fileId)
    if (!filePath) {
      console.error('Failed to find file on disk:', fileId)
      return false
    }
    const error = await shell.openPath(filePath)
    if (error) {
      console.error('Failed to open file:', error)
      return false
    }
    return true
  })

  // Upload files from desktop (via dialog or drag & drop)
  ipcMain.handle('upload-files', async (_event, filePaths: string[]) => {
    const results: { success: boolean; name: string; error?: string }[] = []
    const savedFiles: any[] = []
    for (const fp of filePaths) {
      try {
        const { basename: bn } = require('path')
        const { lookup: lu } = require('mime-types')
        const name = bn(fp)
        const buffer = readFileSync(fp)
        const mimeType = lu(name) || 'application/octet-stream'
        const info = await saveFile(buffer, name, mimeType, 'Desktop')
        savedFiles.push(info)
        results.push({ success: true, name })
      } catch (err: any) {
        results.push({ success: false, name: fp, error: err.message })
      }
    }

    // Broadcast to mobile clients & generate thumbnails
    // (the file watcher now skips recently-saved files to prevent duplicates)
    for (const info of savedFiles) {
      const filePath = getFilePath(info.id)
      if (filePath) {
        generateThumbnail(filePath, info.mimeType, info.id).catch(() => {})
      }
      import('./websocket').then(({ broadcast }) => {
        broadcast('file_uploaded', info)
      })
    }

    return results
  })

  // Open file picker dialog
  ipcMain.handle('pick-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      title: 'Select files to upload',
    })
    if (result.canceled) return []
    return result.filePaths
  })
}

// ── App Lifecycle ─────────────────────────────

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.localdrop.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Load settings
  currentSettings = loadSettings()
  ensureStorageDir(currentSettings.storagePath)

  // Setup IPC before creating window
  setupIPC()

  // Create window
  createWindow()

  // Set up renderer notification bridge
  setRendererNotifier((channel, data) => {
    mainWindow?.webContents.send(channel, data)
  })

  // Start HTTP server
  await startServer(currentSettings)

  // Start UDP discovery
  startDiscovery(currentSettings.port, currentSettings.pinMode)

  // Start file watcher for external files (copy/paste into folder)
  
  // Handle deletions detected by watcher or sync
  setOnExternalFileDeleted((fileId) => {
    import('./websocket').then(({ broadcast }) => {
      broadcast('file_deleted', { id: fileId })
    })
    mainWindow?.webContents.send('file-deleted', { id: fileId })
  })

  // Handle additions detected by watcher or sync
  setOnExternalFileAdded((file) => {
    // Trigger background thumbnail generation
    const filePath = getFilePath(file.id)
    if (filePath) {
      generateThumbnail(filePath, file.mimeType, file.id).catch(() => {})
    }
    
    // Notify clients about new file
    import('./websocket').then(({ broadcast }) => {
      broadcast('file_uploaded', file)
    })
    mainWindow?.webContents.send('file-uploaded', file)
  })

  startFileWatcher()

  // Periodic sync to ensure consistency (every 30s)
  setInterval(async () => {
    await syncExternalFiles()
  }, 30000)

  console.log('═══════════════════════════════════════')
  console.log('  LocalDrop is running!')
  console.log(`  IP: ${getPrimaryIP()}`)
  console.log(`  Port: ${currentSettings.port}`)
  console.log(`  PIN: ${currentSettings.pinMode ? getPin() : 'OFF (No-PIN mode)'}`)
  console.log('═══════════════════════════════════════')

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Cleanup
  stopServer()
  stopDiscovery()
  stopFileWatcher()
  shutdownWebSocket()

  if (process.platform !== 'darwin') {
    app.quit()
  }
})
