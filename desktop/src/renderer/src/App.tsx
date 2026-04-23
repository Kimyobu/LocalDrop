/**
 * LocalDrop — App Component (Phase 2)
 * Blue-to-White gradient theme with QR, toasts, drag & drop
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import type { DeviceInfo, FileInfo, FileListResponse } from '../../../../shared/types'

const api = window.localDrop

// ── Helpers ────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function getFileIcon(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️', '.gif': '🖼️',
    '.webp': '🖼️', '.heic': '🖼️', '.svg': '🖼️', '.bmp': '🖼️',
    '.pdf': '📄', '.doc': '📝', '.docx': '📝',
    '.xls': '📊', '.xlsx': '📊', '.csv': '📊',
    '.ppt': '📑', '.pptx': '📑',
    '.zip': '📦', '.rar': '📦', '.7z': '📦',
    '.mp4': '🎬', '.mov': '🎬', '.avi': '🎬',
    '.mp3': '🎵', '.wav': '🎵',
    '.txt': '📃', '.json': '📃', '.xml': '📃',
  }
  return map[ext.toLowerCase()] || '📎'
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

// ── Types ──────────────────────────────

interface ServerStatus {
  ip: string; ips: string[]; port: number; pin: string
  pinMode: boolean; deviceCount: number; fileCount: number; storageUsed: number
}

interface Toast {
  id: number; message: string; type: 'info' | 'success' | 'error'; icon: string
}

let toastId = 0

// ── App ────────────────────────────────

export default function App() {
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [files, setFiles] = useState<FileInfo[]>([])
  const [fileCount, setFileCount] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [viewMode, setViewMode] = useState<'grid' | 'grid-thumb' | 'list' | 'list-thumb'>('grid-thumb')
  const [sortBy, setSortBy] = useState<'date' | 'size' | 'type' | 'name'>('date')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // ── Toast System ──────────────────

  const addToast = useCallback((message: string, type: Toast['type'] = 'info', icon = '💬') => {
    const id = ++toastId
    setToasts((prev) => [...prev, { id, message, type, icon }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])

  // ── Data Fetching ─────────────────

  const refreshStatus = useCallback(async () => {
    try { setStatus(await api.getStatus()) } catch {}
  }, [])

  const refreshDevices = useCallback(async () => {
    try { setDevices(await api.getDevices()) } catch {}
  }, [])

  const refreshFiles = useCallback(async () => {
    try {
      const r: FileListResponse = await api.getFiles(1, 200)
      setFiles(r.files); setFileCount(r.total)
    } catch {}
  }, [])

  const refreshQR = useCallback(async () => {
    try {
      const resp = await fetch(`http://localhost:${status?.port || 8700}/api/v1/qrcode`)
      const data = await resp.json()
      if (data.qrcode) setQrDataUrl(data.qrcode)
    } catch {}
  }, [status?.port])

  const refreshAll = useCallback(() => {
    refreshStatus(); refreshDevices(); refreshFiles()
  }, [refreshStatus, refreshDevices, refreshFiles])

  // ── Init ──────────────────────────

  // Prevent Electron's default drag-drop navigation
  useEffect(() => {
    const preventDefaults = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }
    document.addEventListener('dragover', preventDefaults)
    document.addEventListener('drop', preventDefaults)
    return () => {
      document.removeEventListener('dragover', preventDefaults)
      document.removeEventListener('drop', preventDefaults)
    }
  }, [])

  useEffect(() => {
    refreshAll()
    const interval = setInterval(refreshAll, 5000)
    return () => clearInterval(interval)
  }, [refreshAll])

  useEffect(() => {
    if (status) refreshQR()
  }, [status?.pin, status?.pinMode, refreshQR])

  // ── IPC Events ────────────────────

  useEffect(() => {
    const cleanups = [
      api.onFileUploaded((data: any) => {
        refreshFiles(); refreshStatus()
        addToast(`📥 ${data?.originalName || 'File'} received`, 'success', '✅')
      }),
      api.onFileDeleted(() => { refreshFiles(); refreshStatus() }),
      api.onDeviceConnected((data: any) => {
        refreshDevices(); refreshStatus()
        addToast(`${data?.name || 'Device'} connected`, 'success', '📱')
      }),
      api.onDeviceDisconnected((data: any) => {
        refreshDevices(); refreshStatus()
        addToast(`${data?.name || 'Device'} disconnected`, 'info', '👋')
      }),
    ]
    return () => cleanups.forEach((fn) => fn())
  }, [refreshFiles, refreshDevices, refreshStatus, addToast])

  // ── Upload Actions ────────────────

  const handleUploadClick = async () => {
    const filePaths: string[] = await api.pickFiles()
    if (filePaths.length === 0) return
    setUploading(true)
    try {
      const results = await api.uploadFiles(filePaths)
      const successCount = results.filter((r: any) => r.success).length
      if (successCount > 0) {
        addToast(`📤 ${successCount} file${successCount > 1 ? 's' : ''} uploaded`, 'success', '✅')
        refreshFiles(); refreshStatus()
      }
      const failures = results.filter((r: any) => !r.success)
      if (failures.length > 0) {
        addToast(`⚠️ ${failures.length} file${failures.length > 1 ? 's' : ''} failed`, 'error', '❌')
      }
    } catch (err: any) {
      addToast(`Upload failed: ${err.message}`, 'error', '❌')
    } finally {
      setUploading(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)

    const droppedFiles = e.dataTransfer.files
    if (droppedFiles.length === 0) return

    const filePaths: string[] = []
    for (let i = 0; i < droppedFiles.length; i++) {
      const f = droppedFiles[i] as any
      if (f.path) filePaths.push(f.path)
    }

    if (filePaths.length === 0) return

    setUploading(true)
    try {
      const results = await api.uploadFiles(filePaths)
      const successCount = results.filter((r: any) => r.success).length
      if (successCount > 0) {
        addToast(`📤 ${successCount} file${successCount > 1 ? 's' : ''} uploaded`, 'success', '✅')
        refreshFiles(); refreshStatus()
      }
    } catch (err: any) {
      addToast(`Upload failed: ${err.message}`, 'error', '❌')
    } finally {
      setUploading(false)
    }
  }

  // ── Actions ───────────────────────

  const handleRefreshPin = async () => {
    await api.refreshPin()
    refreshStatus()
    addToast('PIN refreshed', 'info', '🔄')
  }

  // ── Computed Data ─────────────────
  
  const sortedFiles = [...files].sort((a, b) => {
    let cmp = 0
    if (sortBy === 'date') cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    else if (sortBy === 'size') cmp = a.size - b.size
    else if (sortBy === 'type') cmp = a.extension.localeCompare(b.extension)
    else if (sortBy === 'name') cmp = a.originalName.localeCompare(b.originalName)
    
    return sortOrder === 'asc' ? cmp : -cmp
  })

  // ── Loading ───────────────────────

  if (!status) {
    return (
      <div className="app-layout" style={{ alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #00B2FF, #FFFFFF)' }}>
        <div style={{ textAlign: 'center', color: 'white' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>⚡</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>LocalDrop</div>
          <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>Starting server...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-layout">
      {/* ── Toast Notifications ──── */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span>{t.icon}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* ── Sidebar ──────────────── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1><span>⚡</span> LocalDrop</h1>
          <div className="subtitle">LAN File Sharing</div>
        </div>

        {/* Connection Info */}
        <div className="connection-info">
          {status.pinMode ? (
            <div className="pin-display">
              <div className="pin-label">PIN Code</div>
              <div className="pin-value">{status.pin}</div>
              <button className="btn btn-sidebar btn-sm" style={{ marginTop: 10 }} onClick={handleRefreshPin}>
                🔄 New PIN
              </button>
            </div>
          ) : (
            <div className="pin-display">
              <div className="pin-label">Mode</div>
              <div className="pin-nopin">🔓 Open — No PIN</div>
            </div>
          )}

          {/* QR Code */}
          {qrDataUrl && (
            <div className="qr-container">
              <img src={qrDataUrl} alt="QR Code" />
            </div>
          )}

          <div className="info-row">
            <span className="label">IP Address</span>
            <span className="value">{status.ip}</span>
          </div>
          <div className="info-row">
            <span className="label">Port</span>
            <span className="value">{status.port}</span>
          </div>
          <div className="info-row">
            <span className="label">Mode</span>
            <span className={`mode-badge ${status.pinMode ? 'pin' : 'open'}`}>
              {status.pinMode ? '🔒 PIN' : '🔓 Open'}
            </span>
          </div>
          <div className="info-row">
            <span className="label">Storage</span>
            <span className="value">{formatBytes(status.storageUsed)}</span>
          </div>
        </div>

        {/* Devices */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">📱 Devices ({devices.length})</div>
        </div>
        <div className="device-list">
          {devices.length === 0 ? (
            <div className="empty-state">
              <div className="icon">📡</div>
              <div>Waiting for devices...</div>
              <div style={{ marginTop: 4, fontSize: 11, opacity: 0.6 }}>
                Scan the QR code with your phone
              </div>
            </div>
          ) : (
            devices.map((d) => (
              <div key={d.id} className="device-card slide-in">
                <div className="device-icon">{d.platform === 'mobile' ? '📱' : '💻'}</div>
                <div className="device-details">
                  <div className="device-name">{d.name}</div>
                  <div className="device-ip">{d.ip}</div>
                </div>
                <div className="device-status" />
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ── Main Content ─────────── */}
      <main className="main-content"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="main-header">
          <h2>📁 Files <span className="file-count">({fileCount})</span></h2>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={handleUploadClick} disabled={uploading}>
              {uploading ? '⏳ Uploading...' : '📤 Upload'}
            </button>
            <button className="btn" onClick={() => api.openStorageFolder()}>📂 Open Folder</button>
            <button className="btn" onClick={refreshFiles}>🔄 Refresh</button>
            <button className="btn" onClick={() => setShowSettings(true)}>⚙️ Settings</button>
          </div>
        </div>
        
        {/* ── Toolbar ─────────── */}
        <div className="toolbar">
          <div className="toolbar-group">
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-500)', marginLeft: 8 }}>Sort By:</span>
            <div className="toolbar-select-wrapper">
              <select className="toolbar-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}>
                <option value="date">Created / Modified</option>
                <option value="size">Size</option>
                <option value="type">Type</option>
                <option value="name">Name (A-Z)</option>
              </select>
            </div>
          </div>
          <div className="toolbar-group">
            <button 
              className={`toolbar-btn ${sortOrder === 'asc' ? 'active' : ''}`} 
              onClick={() => setSortOrder('asc')}
              aria-pressed={sortOrder === 'asc'}
              aria-label="Sort Ascending"
            >Asc</button>
            <button 
              className={`toolbar-btn ${sortOrder === 'desc' ? 'active' : ''}`} 
              onClick={() => setSortOrder('desc')}
              aria-pressed={sortOrder === 'desc'}
              aria-label="Sort Descending"
            >Desc</button>
          </div>
          <div style={{ flex: 1 }} />
          <div className="toolbar-group">
            <button 
              className={`toolbar-btn ${viewMode === 'grid' ? 'active' : ''}`} 
              onClick={() => setViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
            >Grid</button>
            <button 
              className={`toolbar-btn ${viewMode === 'grid-thumb' ? 'active' : ''}`} 
              onClick={() => setViewMode('grid-thumb')}
              aria-pressed={viewMode === 'grid-thumb'}
            >Grid (Thumb)</button>
            <button 
              className={`toolbar-btn ${viewMode === 'list' ? 'active' : ''}`} 
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
            >List</button>
            <button 
              className={`toolbar-btn ${viewMode === 'list-thumb' ? 'active' : ''}`} 
              onClick={() => setViewMode('list-thumb')}
              aria-pressed={viewMode === 'list-thumb'}
            >List (Thumb)</button>
          </div>
        </div>

        {/* Drag overlay */}
        {dragging && (
          <div className="drag-overlay">
            <div className="drag-overlay-content">
              <div style={{ fontSize: 56 }}>📥</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 12 }}>Drop files here</div>
              <div style={{ fontSize: 13, color: 'var(--gray-400)', marginTop: 4 }}>Release to upload</div>
            </div>
          </div>
        )}

        <div className="file-area">
          {files.length === 0 ? (
            <button className="drop-zone" onClick={handleUploadClick} aria-label="Upload files">
              <div className="icon">📤</div>
              <div className="title">No files yet</div>
              <div className="subtitle">Click to upload or drag & drop files here</div>
            </button>
          ) : (
            <div className={`file-${viewMode.startsWith('grid') ? 'grid' : 'list'}`}>
              {sortedFiles.map((file) => {
                const isPreviewable = file.mimeType.startsWith('image/') || file.mimeType === 'application/pdf'
                const loadThumb = (viewMode === 'grid-thumb' || viewMode === 'list-thumb') && isPreviewable
                const thumbnailUrl = loadThumb ? `http://127.0.0.1:${status.port}/api/v1/files/${file.id}/thumbnail` : null

                if (viewMode.startsWith('list')) {
                  return (
                    <button key={file.id} className="file-card fade-in" onClick={() => api.openFile(file.id)} aria-label={`Open ${file.originalName}`}>
                      <div className="file-icon" style={{ position: 'relative' }}>
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {getFileIcon(file.extension)}
                        </div>
                        {thumbnailUrl && (
                          <img 
                            src={thumbnailUrl} 
                            alt="" 
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: '6px' }}
                            onError={(e) => {
                              e.currentTarget.style.display = 'none'
                            }}
                          />
                        )}
                      </div>
                      <div className="file-details-container">
                        <div className="file-name" title={file.originalName}>{file.originalName}</div>
                        <div className="file-meta">
                          <div className="file-size">{formatBytes(file.size)} · {timeAgo(file.createdAt)}</div>
                          {file.uploadedBy ? <div className="file-from">from {file.uploadedBy}</div> : <div className="file-from" />}
                        </div>
                      </div>
                    </button>
                  )
                }

                return (
                  <button key={file.id} className="file-card fade-in" onClick={() => api.openFile(file.id)} aria-label={`Open ${file.originalName}`}>
                    <div className="file-icon" style={{ position: 'relative' }}>
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {getFileIcon(file.extension)}
                      </div>
                      {thumbnailUrl && (
                        <img 
                          src={thumbnailUrl} 
                          alt="" 
                          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', borderRadius: '4px' }}
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                          }}
                        />
                      )}
                    </div>
                    <div className="file-name" title={file.originalName}>{file.originalName}</div>
                    <div className="file-size">{formatBytes(file.size)} · {timeAgo(file.createdAt)}</div>
                    {file.uploadedBy && <div className="file-from">from {file.uploadedBy}</div>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Status Bar */}
        <div className="status-bar">
          <div className="status-item"><div className="status-dot" /><span>Online</span></div>
          <div className="status-item">📱 {devices.length} device{devices.length !== 1 ? 's' : ''}</div>
          <div className="status-item">📁 {fileCount} file{fileCount !== 1 ? 's' : ''}</div>
          <div className="status-item">💾 {formatBytes(status.storageUsed)}</div>
          <div style={{ flex: 1 }} />
          <div className="status-item">LAN · {status.ip}:{status.port}</div>
        </div>
      </main>

      {/* ── Settings ─────────────── */}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onSaved={() => { setShowSettings(false); refreshStatus(); addToast('Settings saved', 'success', '✅') }}
        />
      )}
    </div>
  )
}

// ── Settings Modal ─────────────────────

function SettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [pinMode, setPinMode] = useState(true)
  const [maxFileSize, setMaxFileSize] = useState(500)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getSettings().then((s) => {
      setPinMode(s.pinMode)
      setMaxFileSize(Math.round(s.maxFileSize / (1024 * 1024)))
      setLoading(false)
    })
  }, [])

  const handleSave = async () => {
    await api.updateSettings({ pinMode, maxFileSize: maxFileSize * 1024 * 1024 })
    onSaved()
  }

  if (loading) return null

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h3>⚙️ Settings</h3>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="settings-body">
          <div className="setting-group">
            <label>PIN Mode</label>
            <div className="description">Require PIN to connect. Disable for quick access on trusted networks.</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label className="toggle">
                <input type="checkbox" checked={pinMode} onChange={(e) => setPinMode(e.target.checked)} />
                <span className="slider" />
              </label>
              <span style={{ fontSize: 13, color: '#64748B' }}>
                {pinMode ? '🔒 PIN Required' : '🔓 Open Mode'}
              </span>
            </div>
          </div>
          <div className="setting-group">
            <label>Max File Size (MB)</label>
            <div className="description">Maximum size per file upload.</div>
            <input type="number" value={maxFileSize} onChange={(e) => setMaxFileSize(parseInt(e.target.value) || 100)} min={1} max={10240} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 28 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave}>💾 Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}
