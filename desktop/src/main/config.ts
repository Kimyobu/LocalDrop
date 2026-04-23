/**
 * LocalDrop — Configuration
 */
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import type { AppSettings } from '../../../shared/types'
import { DEFAULT_SETTINGS } from '../../../shared/types'

const CONFIG_FILE = 'localdrop-settings.json'

function getConfigPath(): string {
  const userDataPath = app.getPath('userData')
  return join(userDataPath, CONFIG_FILE)
}

function getDefaultFilesPath(): string {
  // ในโหมด Development ให้ใช้โฟลเดอร์ ./files ในโปรเจค
  if (!app.isPackaged) {
    return join(__dirname, '../../files')
  }
  
  // ในโหมด Production (AppImage) ให้เก็บไว้ที่ ~/LocalDrop/files
  return join(app.getPath('home'), 'LocalDrop', 'files')
}

export function loadSettings(): AppSettings {
  try {
    const configPath = getConfigPath()
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8')
      const saved = JSON.parse(raw) as Partial<AppSettings>
      return { ...DEFAULT_SETTINGS, ...saved }
    }
  } catch (err) {
    console.error('[Config] Failed to load settings:', err)
  }

  // Return defaults with resolved storage path
  return {
    ...DEFAULT_SETTINGS,
    storagePath: getDefaultFilesPath(),
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    const configPath = getConfigPath()
    const dir = join(configPath, '..')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(configPath, JSON.stringify(settings, null, 2), 'utf-8')
    console.log('[Config] Settings saved')
  } catch (err) {
    console.error('[Config] Failed to save settings:', err)
  }
}

export function ensureStorageDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
    console.log('[Config] Created storage directory:', path)
  }
}
