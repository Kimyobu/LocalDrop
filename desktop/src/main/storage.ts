/**
 * LocalDrop — File Storage Manager
 * Safe file operations with metadata tracking
 */
import { readdir, stat, unlink, writeFile, readFile } from 'fs/promises'
import { existsSync, mkdirSync, createReadStream, watch, statSync } from 'fs'
import { join, extname, basename } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { lookup } from 'mime-types'
import type { FileInfo, FileListResponse } from '../../../shared/types'
import type { ReadStream, FSWatcher } from 'fs'

// In-memory metadata store (persisted to JSON file)
let fileMetadata: Map<string, FileInfo> = new Map()
let storagePath: string = './files'
let metadataPath: string = './files/.metadata.json'

// Track recently saved files to prevent file watcher from creating duplicates
// When saveFile() writes a file to disk, the watcher may detect it as "new"
// and create a second metadata entry. This set prevents that.
const recentlySavedNames: Set<string> = new Set()

/** Initialize storage with given path */
export async function initStorage(path: string): Promise<void> {
  storagePath = path
  metadataPath = join(path, '.metadata.json')

  if (!existsSync(storagePath)) {
    mkdirSync(storagePath, { recursive: true })
  }

  await loadMetadata()

  // Full reconciliation between disk and metadata on startup
  // This catches any files added/removed while the app was closed
  await syncExternalFiles()

  console.log(`[Storage] Initialized at: ${storagePath} (${fileMetadata.size} files tracked)`)
}

// ── Metadata Persistence ───────────────────────

async function loadMetadata(): Promise<void> {
  try {
    if (existsSync(metadataPath)) {
      const raw = await readFile(metadataPath, 'utf-8')
      const arr: FileInfo[] = JSON.parse(raw)
      fileMetadata = new Map(arr.map((f) => [f.id, f]))
      console.log(`[Storage] Loaded ${fileMetadata.size} file records`)
    }
  } catch (err) {
    console.error('[Storage] Failed to load metadata:', err)
    fileMetadata = new Map()
  }
}

async function saveMetadata(): Promise<void> {
  try {
    const arr = Array.from(fileMetadata.values())
    await writeFile(metadataPath, JSON.stringify(arr, null, 2), 'utf-8')
  } catch (err) {
    console.error('[Storage] Failed to save metadata:', err)
  }
}

// ── Safe Filename ──────────────────────────────

/** Sanitize filename to prevent path traversal and invalid chars */
function sanitizeFilename(name: string): string {
  // Remove path separators and dangerous chars
  let safe = basename(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '_') // no leading dots
    .trim()

  if (!safe || safe === '_') {
    safe = 'unnamed_file'
  }

  return safe
}

/** Generate unique filename if collision exists */
function uniqueFilename(name: string): string {
  const ext = extname(name)
  const base = basename(name, ext)
  let candidate = name
  let counter = 1

  while (existsSync(join(storagePath, candidate))) {
    candidate = `${base}_${counter}${ext}`
    counter++
  }

  return candidate
}

// ── File Operations ────────────────────────────

/** Save uploaded file and return metadata */
export async function saveFile(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  uploadedBy?: string
): Promise<FileInfo> {
  const safeName = sanitizeFilename(originalName)
  const finalName = uniqueFilename(safeName)
  const filePath = join(storagePath, finalName)

  // Mark this filename as recently saved BEFORE writing to disk
  // so the file watcher won't create a duplicate metadata entry
  recentlySavedNames.add(finalName)

  await writeFile(filePath, buffer)

  const info: FileInfo = {
    id: uuidv4(),
    name: finalName,
    originalName,
    size: buffer.length,
    mimeType,
    extension: extname(finalName).toLowerCase(),
    createdAt: new Date().toISOString(),
    uploadedBy,
  }

  fileMetadata.set(info.id, info)
  await saveMetadata()

  // Keep the name in the set for a while, then clean up
  // (watcher has a 500ms debounce, so 3s is more than enough)
  setTimeout(() => recentlySavedNames.delete(finalName), 3000)

  console.log(`[Storage] Saved: ${finalName} (${formatBytes(info.size)})`)
  return info
}

/** List files with pagination */
export async function listFiles(
  page: number = 1,
  pageSize: number = 50,
  typeFilter?: string
): Promise<FileListResponse> {
  // NOTE: We no longer call syncExternalFiles() here.
  // Syncing on every list call caused duplicate entries during rapid multi-file uploads
  // because the watcher + sync would race with saveFile().
  // External file sync is handled by: initStorage(), startFileWatcher(), and periodic sync.

  let files = Array.from(fileMetadata.values())

  // Filter by type (e.g., 'image', 'document')
  if (typeFilter) {
    files = files.filter((f) => {
      if (typeFilter === 'image') return f.mimeType.startsWith('image/')
      if (typeFilter === 'document') return f.mimeType.startsWith('application/')
      if (typeFilter === 'video') return f.mimeType.startsWith('video/')
      return true
    })
  }

  // Sort by newest first
  files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const total = files.length
  const start = (page - 1) * pageSize
  const paged = files.slice(start, start + pageSize)

  return { files: paged, total, page, pageSize }
}

/** Get file info by ID */
export function getFileInfo(id: string): FileInfo | undefined {
  return fileMetadata.get(id)
}

/** Get readable stream for downloading */
export function getFileStream(id: string): ReadStream | null {
  const info = fileMetadata.get(id)
  if (!info) return null

  const filePath = join(storagePath, info.name)
  if (!existsSync(filePath)) return null

  return createReadStream(filePath)
}

/** Get full file path */
export function getFilePath(id: string): string | null {
  const info = fileMetadata.get(id)
  if (!info) return null

  const filePath = join(storagePath, info.name)
  if (!existsSync(filePath)) return null

  return filePath
}

/** Delete file by ID */
export async function deleteFile(id: string): Promise<boolean> {
  const info = fileMetadata.get(id)
  if (!info) return false

  const filePath = join(storagePath, info.name)

  try {
    if (existsSync(filePath)) {
      await unlink(filePath)
    }
    fileMetadata.delete(id)
    await saveMetadata()
    console.log(`[Storage] Deleted: ${info.name}`)
    return true
  } catch (err) {
    console.error(`[Storage] Failed to delete ${info.name}:`, err)
    return false
  }
}

/** Get total storage usage */
export function getStorageUsed(): number {
  let total = 0
  for (const info of fileMetadata.values()) {
    total += info.size
  }
  return total
}

/** Get file count */
export function getFileCount(): number {
  return fileMetadata.size
}

// ── Validation ─────────────────────────────────

/** Check if file extension is allowed */
export function isAllowedExtension(filename: string, allowed: string[]): boolean {
  if (!allowed || allowed.length === 0 || allowed.includes('*')) return true
  const ext = extname(filename).toLowerCase()
  return allowed.includes(ext)
}

/** Check if file size is within limit */
export function isWithinSizeLimit(size: number, maxSize: number): boolean {
  return size <= maxSize
}

// ── Helpers ────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// ── File Watcher ───────────────────────────────

let watcher: FSWatcher | null = null
let onExternalFileAdded: ((file: FileInfo) => void) | null = null
let onExternalFileDeleted: ((fileId: string) => void) | null = null

/** Set callback for when external files are detected */
export function setOnExternalFileAdded(cb: (file: FileInfo) => void): void {
  onExternalFileAdded = cb
}

/** Set callback for when external file deletions are detected */
export function setOnExternalFileDeleted(cb: (fileId: string) => void): void {
  onExternalFileDeleted = cb
}

/** Get the current storage path */
export function getStoragePath(): string {
  return storagePath
}

/** Scan the storage folder for files not tracked in metadata and remove stale metadata */
export async function syncExternalFiles(): Promise<{ added: FileInfo[], removed: string[] }> {
  const added: FileInfo[] = []
  const removed: string[] = []
  try {
    const entries = await readdir(storagePath)
    const diskNames = new Set(entries)
    const trackedFiles = Array.from(fileMetadata.values())

    // 1. Remove stale records (in metadata but not on disk)
    for (const file of trackedFiles) {
      if (file.name.startsWith('.')) continue
      if (!diskNames.has(file.name)) {
        fileMetadata.delete(file.id)
        removed.push(file.id)
        console.log(`[Storage] Removed stale metadata: ${file.name}`)
        if (onExternalFileDeleted) onExternalFileDeleted(file.id)
      }
    }

    // 2. Add new records (on disk but not in metadata)
    const trackedNames = new Set(
      Array.from(fileMetadata.values()).map((f) => f.name)
    )

    for (const entry of entries) {
      if (entry.startsWith('.')) continue // skip hidden / metadata
      if (trackedNames.has(entry)) continue // already tracked

      const filePath = join(storagePath, entry)
      try {
        const s = statSync(filePath)
        if (!s.isFile()) continue

        const mimeType = lookup(entry) || 'application/octet-stream'
        const info: FileInfo = {
          id: uuidv4(),
          name: entry,
          originalName: entry,
          size: s.size,
          mimeType,
          extension: extname(entry).toLowerCase(),
          createdAt: s.birthtime.toISOString(),
          uploadedBy: 'Local',
        }

        fileMetadata.set(info.id, info)
        added.push(info)
        console.log(`[Storage] Synced external file: ${entry}`)
        if (onExternalFileAdded) onExternalFileAdded(info)
      } catch {}
    }

    if (added.length > 0 || removed.length > 0) {
      await saveMetadata()
    }
  } catch (err) {
    console.error('[Storage] Failed to sync external files:', err)
  }
  return { added, removed }
}

/** Start watching the storage folder for new files */
export function startFileWatcher(): void {
  if (watcher) return

  // Do an initial sync
  syncExternalFiles()

  watcher = watch(storagePath, { persistent: false }, async (eventType, filename) => {
    if (!filename || filename.startsWith('.')) return
    if (eventType !== 'rename') return

    const filePath = join(storagePath, filename)

    // Debounce: wait a moment for the file to finish writing or being deleted
    setTimeout(async () => {
      try {
        // CASE 1: File deleted from disk
        if (!existsSync(filePath)) {
          const tracked = Array.from(fileMetadata.values()).find((f) => f.name === filename)
          if (tracked) {
            fileMetadata.delete(tracked.id)
            await saveMetadata()
            console.log(`[Storage] Watcher detected deletion: ${filename}`)
            if (onExternalFileDeleted) onExternalFileDeleted(tracked.id)
          }
          return
        }

        // CASE 2: New file added to disk
        // Skip if this file was recently saved by the API (saveFile)
        // This prevents the watcher from creating a duplicate metadata entry
        if (recentlySavedNames.has(filename)) {
          console.log(`[Storage] Watcher: skipping recently-saved file: ${filename}`)
          return
        }

        const isTracked = Array.from(fileMetadata.values()).some((f) => f.name === filename)
        if (isTracked) return

        const s = statSync(filePath)
        if (!s.isFile() || s.size === 0) return

        const mimeType = lookup(filename) || 'application/octet-stream'
        const info: FileInfo = {
          id: uuidv4(),
          name: filename,
          originalName: filename,
          size: s.size,
          mimeType,
          extension: extname(filename).toLowerCase(),
          createdAt: new Date().toISOString(),
          uploadedBy: 'Local',
        }

        fileMetadata.set(info.id, info)
        await saveMetadata()
        console.log(`[Storage] Watcher detected new file: ${filename}`)

        if (onExternalFileAdded) onExternalFileAdded(info)
      } catch {}
    }, 500)
  })

  console.log('[Storage] File watcher started')
}

/** Stop the file watcher */
export function stopFileWatcher(): void {
  if (watcher) {
    watcher.close()
    watcher = null
    console.log('[Storage] File watcher stopped')
  }
}
