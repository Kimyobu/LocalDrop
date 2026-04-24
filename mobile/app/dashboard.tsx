/**
 * LocalDrop Mobile — Dashboard Screen
 * Browse remote files, upload from device, download to device
 */
import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, RefreshControl, Platform,
} from 'react-native'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import * as LegacyFileSystem from 'expo-file-system/legacy'
import * as MediaLibrary from 'expo-media-library'
import * as Sharing from 'expo-sharing'
import { router } from 'expo-router'
import { ScrollView } from 'react-native'
import { listFiles, uploadFiles, getDownloadUrl, getThumbnailUrl, deleteFile, isConnected, connectWebSocket, disconnectWebSocket, unpair } from '../src/api/client'

interface FileInfo {
  id: string; name: string; originalName: string; size: number
  mimeType: string; extension: string; createdAt: string; uploadedBy?: string
}

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
    '.webp': '🖼️', '.heic': '🖼️', '.pdf': '📄',
    '.doc': '📝', '.docx': '📝', '.xls': '📊', '.xlsx': '📊',
    '.zip': '📦', '.rar': '📦', '.mp4': '🎬', '.mp3': '🎵',
    '.txt': '📃',
  }
  return map[ext.toLowerCase()] || '📎'
}

// ── ย้ายออกนอก DashboardScreen เพื่อกัน re-create ทุก render ──

const FileThumbnail = memo(({ id, ext, isGrid, isPreviewable, loadThumb }: {
  id: string, ext: string, isGrid: boolean, isPreviewable: boolean, loadThumb: boolean
}) => {
  const [hasError, setHasError] = useState(false)
  const iconStyle = isGrid ? styles.gridFileIcon : styles.fileIcon
  const thumbStyle = isGrid ? styles.gridThumbnail : styles.thumbnail

  if (!loadThumb || !isPreviewable || hasError) {
    return <Text style={iconStyle}>{getFileIcon(ext)}</Text>
  }

  return (
    <Image
      source={getThumbnailUrl(id)}
      style={thumbStyle}
      contentFit="cover"
      cachePolicy="disk"
      transition={200}
      onError={() => setHasError(true)}
    />
  )
})

// Progress bar แยกต่างหาก — รับ ref แทน state เพื่อกัน parent re-render
const DownloadProgressBar = memo(({ fileId, downloadingFileId, progress }: {
  fileId: string
  downloadingFileId: string | null
  progress: number
}) => {
  if (downloadingFileId !== fileId) return null
  return (
    <View style={styles.progressBarContainer}>
      <View style={[styles.progressBar, { width: `${Math.round(progress * 100)}%` }]} />
    </View>
  )
})

const FileItem = memo(({ item, viewMode, isDownloading, downloadingFileId, progress, onOpen, onDelete, onDownload }: {
  item: FileInfo
  viewMode: string
  isDownloading: boolean
  downloadingFileId: string | null
  progress: number
  onOpen: (f: FileInfo) => void
  onDelete: (f: FileInfo) => void
  onDownload: (f: FileInfo) => void
}) => {
  const isPreviewable = item.mimeType.startsWith('image/') || item.mimeType === 'application/pdf'
  const loadThumb = (viewMode === 'grid-thumb' || viewMode === 'list-thumb') && isPreviewable

  if (viewMode.startsWith('grid')) {
    return (
      <TouchableOpacity style={styles.gridCard} onPress={() => onOpen(item)} onLongPress={() => onDelete(item)} activeOpacity={0.7}>
        <View style={styles.gridIconContainer}>
          <FileThumbnail id={item.id} ext={item.extension} isGrid={true} isPreviewable={isPreviewable} loadThumb={loadThumb} />
          {isDownloading && (
            <View style={styles.gridProgressOverlay}>
              <Text style={styles.progressText}>{Math.round(progress * 100)}%</Text>
            </View>
          )}
        </View>
        <Text style={styles.gridFileName} numberOfLines={1}>{item.originalName}</Text>
        <Text style={styles.gridFileMeta}>{formatBytes(item.size)}</Text>
        <DownloadProgressBar fileId={item.id} downloadingFileId={downloadingFileId} progress={progress} />
      </TouchableOpacity>
    )
  }

  return (
    <TouchableOpacity style={styles.fileCard} onPress={() => onOpen(item)} onLongPress={() => onDelete(item)} activeOpacity={0.7}>
      <View style={styles.fileIconContainer}>
        <FileThumbnail id={item.id} ext={item.extension} isGrid={false} isPreviewable={isPreviewable} loadThumb={loadThumb} />
      </View>
      <View style={styles.fileInfo}>
        <Text style={styles.fileName} numberOfLines={1}>{item.originalName}</Text>
        <Text style={styles.fileMeta}>
          {formatBytes(item.size)}{item.uploadedBy ? ` · from ${item.uploadedBy}` : ''}
        </Text>
        <DownloadProgressBar fileId={item.id} downloadingFileId={downloadingFileId} progress={progress} />
      </View>
      <TouchableOpacity
        style={[styles.downloadButton, isDownloading && styles.downloadButtonActive]}
        onPress={() => onDownload(item)}
        disabled={isDownloading}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        {isDownloading ? (
          <ActivityIndicator size="small" color="#00B2FF" />
        ) : (
          <Text style={styles.downloadButtonText}>⬇️</Text>
        )}
      </TouchableOpacity>
    </TouchableOpacity>
  )
})

// ─────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)

  const [viewMode, setViewMode] = useState<'grid' | 'grid-thumb' | 'list' | 'list-thumb'>('list-thumb')
  const [sortBy, setSortBy] = useState<'date' | 'size' | 'type' | 'name'>('date')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // Redirect if not connected
  useEffect(() => {
    if (!isConnected()) {
      router.replace('/')
      return
    }

    connectWebSocket((msg) => {
      if (msg.event === 'file_uploaded' || msg.event === 'file_deleted') {
        fetchFiles()
      }
    })

    return () => { disconnectWebSocket() }
  }, [])

  const fetchFiles = useCallback(async () => {
    try {
      const data = await listFiles(1, 200)
      setFiles(data.files || [])
    } catch (err) {
      console.error('Failed to fetch files:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchFiles() }, [fetchFiles])

  useEffect(() => {
    if (files.length > 0) {
      const toPrefetch = files
        .filter(f => f.mimeType.startsWith('image/') || f.mimeType === 'application/pdf')
        .slice(0, 20)
        .map(f => getThumbnailUrl(f.id))
      Image.prefetch(toPrefetch)
    }
  }, [files])

  const onRefresh = () => { setRefreshing(true); fetchFiles() }

  // ── Upload from Gallery ───────────

  const handlePickImages = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') return Alert.alert('Permission needed', 'Please allow photo access')

    const result = await ImagePicker.launchImageLibraryAsync({ allowsMultipleSelection: true, quality: 1 })
    if (!result.canceled && result.assets.length > 0) {
      setUploading(true)
      try {
        const filesToUpload = result.assets.map((a) => ({
          uri: a.uri,
          name: a.fileName || `photo_${Date.now()}.jpg`,
          type: a.mimeType || 'image/jpeg',
        }))
        const res = await uploadFiles(filesToUpload)
        if (res.success) {
          Alert.alert('✅ Uploaded', `${res.files.length} file(s) sent to desktop`)
          fetchFiles()
        } else {
          Alert.alert('Error', res.errors?.join('\n') || 'Upload failed')
        }
      } catch (err: any) {
        Alert.alert('Upload Failed', err.message)
      } finally {
        setUploading(false)
      }
    }
  }

  // ── Upload Document ───────────────

  const handlePickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, type: '*/*' })
    if (result.canceled) return

    setUploading(true)
    try {
      const filesToUpload = result.assets.map((a) => ({
        uri: a.uri, name: a.name, type: a.mimeType || 'application/octet-stream',
      }))
      const res = await uploadFiles(filesToUpload)
      if (res.success) {
        Alert.alert('✅ Uploaded', `${res.files.length} file(s) sent to desktop`)
        fetchFiles()
      }
    } catch (err: any) {
      Alert.alert('Upload Failed', err.message)
    } finally {
      setUploading(false)
    }
  }

  // ── Open File ───────────────────

  const handleOpenFile = async (file: FileInfo) => {
    try {
      const url = await getDownloadUrl(file.id)
      const response = await fetch(url)
      const blob = await response.blob()
      const reader = new FileReader()

      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1]
          const destFile = new FileSystem.File(FileSystem.Paths.cache, file.originalName)
          if (destFile.exists) destFile.delete()
          destFile.create()
          destFile.write(base64, { encoding: 'base64' })

          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(destFile.uri, { dialogTitle: `Open ${file.originalName}`, UTI: file.mimeType })
          } else {
            Alert.alert('Not supported', 'Sharing is not available on this device')
          }
        } catch (err: any) {
          Alert.alert('Open Failed', err.message)
        }
      }
      reader.readAsDataURL(blob)
    } catch (err: any) {
      Alert.alert('Download Failed', err.message)
    }
  }

  // ── Save to Gallery / Device ──────

  const handleDownload = async (file: FileInfo) => {
    try {
      setDownloadingFileId(file.id)
      setDownloadProgress(0)

      const url = await getDownloadUrl(file.id)
      const cachePath = FileSystem.Paths.cache.uri + file.originalName

      // ลบไฟล์เก่าถ้ามี
      const existing = new FileSystem.File(FileSystem.Paths.cache, file.originalName)
      if (existing.exists) existing.delete()

      // Download พร้อม progress
      const downloadResumable = LegacyFileSystem.createDownloadResumable(
        url,
        cachePath,
        {},
        (p) => {
          if (p.totalBytesExpectedToWrite > 0) {
            setDownloadProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite)
          }
        }
      )

      const result = await downloadResumable.downloadAsync()
      if (!result) throw new Error('Download failed')

      const isMedia = file.mimeType.startsWith('image/') || file.mimeType.startsWith('video/')

      if (isMedia) {
        // รูป/วิดีโอ → บันทึกลง Gallery โดยตรง
        const { status } = await MediaLibrary.requestPermissionsAsync()
        if (status === 'granted') {
          await MediaLibrary.saveToLibraryAsync(result.uri)
          Alert.alert('✅ Saved', `${file.originalName} saved to gallery`)
        } else {
          await Sharing.shareAsync(result.uri, { mimeType: file.mimeType, dialogTitle: `Save ${file.originalName}` })
        }
      } else {
        // ไฟล์อื่น → Share Sheet (ให้ user เลือกบันทึกเองผ่าน Files/Drive/etc.)
        await Sharing.shareAsync(result.uri, {
          mimeType: file.mimeType,
          dialogTitle: `Save ${file.originalName}`,
          UTI: file.mimeType,
        })
      }
    } catch (err: any) {
      Alert.alert('Download Failed', err.message)
    } finally {
      setDownloadingFileId(null)
      setDownloadProgress(0)
    }
  }

  // ── Delete File ───────────────────

  const handleDelete = (file: FileInfo) => {
    Alert.alert('Delete File', `Delete "${file.originalName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try { await deleteFile(file.id); fetchFiles() } catch { }
        },
      },
    ])
  }

  // ── Computed Data ─────────────────

  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      let cmp = 0
      if (sortBy === 'date') cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      else if (sortBy === 'size') cmp = a.size - b.size
      else if (sortBy === 'type') cmp = a.extension.localeCompare(b.extension)
      else if (sortBy === 'name') cmp = a.originalName.localeCompare(b.originalName)
      return sortOrder === 'asc' ? cmp : -cmp
    })
  }, [files, sortBy, sortOrder])

  // useCallback เพื่อกัน renderFile เปลี่ยน reference ทุก render
  const handleOpenFileCb = useCallback(handleOpenFile, [])
  const handleDeleteCb = useCallback(handleDelete, [files])
  const handleDownloadCb = useCallback(handleDownload, [])

  const renderFile = useCallback(({ item }: { item: FileInfo }) => (
    <FileItem
      item={item}
      viewMode={viewMode}
      isDownloading={downloadingFileId === item.id}
      downloadingFileId={downloadingFileId}
      progress={downloadingFileId === item.id ? downloadProgress : 0}
      onOpen={handleOpenFileCb}
      onDelete={handleDeleteCb}
      onDownload={handleDownloadCb}
    />
  ), [viewMode, downloadingFileId, downloadProgress, handleOpenFileCb, handleDeleteCb, handleDownloadCb])

  const isGrid = viewMode.startsWith('grid')

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>📁 Files</Text>
          <Text style={styles.headerSubtitle}>{files.length} file{files.length !== 1 ? 's' : ''} on desktop</Text>
        </View>
        <TouchableOpacity style={styles.disconnectBtn} onPress={() => router.replace('/')}>
          <Text style={styles.disconnectText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbarContent}>
          <TouchableOpacity style={styles.toolbarBtn} onPress={() => {
            const options = ['date', 'size', 'type', 'name'] as const
            setSortBy(options[(options.indexOf(sortBy) + 1) % options.length])
          }}>
            <Text style={styles.toolbarText}>Sort: {sortBy.charAt(0).toUpperCase() + sortBy.slice(1)}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.toolbarBtn} onPress={() => setSortOrder(o => o === 'asc' ? 'desc' : 'asc')}>
            <Text style={styles.toolbarText}>{sortOrder === 'asc' ? '⬆️ Asc' : '⬇️ Desc'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.toolbarBtn} onPress={() => {
            const options = ['list-thumb', 'list', 'grid-thumb', 'grid'] as const
            setViewMode(options[(options.indexOf(viewMode) + 1) % options.length])
          }}>
            <Text style={styles.toolbarText}>View: {viewMode}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Upload Overlay */}
      {uploading && (
        <View style={styles.uploadingOverlay}>
          <ActivityIndicator color="#00B2FF" size="large" />
          <Text style={styles.uploadingText}>Uploading...</Text>
        </View>
      )}

      {/* File List */}
      <FlatList
        key={isGrid ? 'grid' : 'list'}
        numColumns={isGrid ? 2 : 1}
        data={sortedFiles}
        renderItem={renderFile}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, isGrid && styles.gridList]}
        columnWrapperStyle={isGrid ? styles.columnWrapper : undefined}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#00B2FF']} tintColor="#00B2FF" />}
        initialNumToRender={10}
        windowSize={5}
        maxToRenderPerBatch={5}
        updateCellsBatchingPeriod={30}
        removeClippedSubviews={true}
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyState}><ActivityIndicator color="#00B2FF" size="large" /></View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyTitle}>No files yet</Text>
              <Text style={styles.emptySubtitle}>Tap the buttons below to upload</Text>
            </View>
          )
        }
      />

      {/* Upload Actions */}
      <View style={styles.actionBar}>
        <TouchableOpacity style={styles.actionBtn} onPress={handlePickImages} activeOpacity={0.8}>
          <Text style={styles.actionIcon}>🖼️</Text>
          <Text style={styles.actionText}>Photos</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={handlePickDocument} activeOpacity={0.8}>
          <Text style={styles.actionIcon}>📄</Text>
          <Text style={styles.actionText}>Files</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, styles.actionBtnRefresh]} onPress={onRefresh} activeOpacity={0.8}>
          <Text style={styles.actionIcon}>🔄</Text>
          <Text style={[styles.actionText, { color: '#64748B' }]}>Refresh</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },

  header: {
    backgroundColor: '#00B2FF',
    paddingTop: 56, paddingBottom: 20, paddingHorizontal: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#FFFFFF' },
  headerSubtitle: { fontSize: 14, color: '#E0F2FE', marginTop: 2, fontWeight: '500' },
  disconnectBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  disconnectText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  list: { padding: 16, paddingBottom: 100 },

  fileCard: {
    backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: 8, borderWidth: 1, borderColor: '#F1F5F9',
  },
  fileIconContainer: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  fileIcon: { fontSize: 28 },
  thumbnail: { width: 44, height: 44, borderRadius: 8, backgroundColor: '#F1F5F9' },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 14, fontWeight: '600', color: '#1E293B' },
  fileMeta: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  downloadButton: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  downloadButtonText: { fontSize: 16 },
  downloadButtonActive: { backgroundColor: '#E0F2FE', borderColor: '#00B2FF' },

  emptyState: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 56, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#475569' },
  emptySubtitle: { fontSize: 14, color: '#94A3B8', marginTop: 4 },

  actionBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 8,
    padding: 16, paddingBottom: 32,
    backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#F1F5F9',
  },
  actionBtn: { flex: 1, backgroundColor: '#00B2FF', borderRadius: 12, padding: 12, alignItems: 'center' },
  actionBtnRefresh: { backgroundColor: '#F1F5F9', shadowColor: '#000', shadowOpacity: 0.05 },
  actionIcon: { fontSize: 22, marginBottom: 2 },
  actionText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },

  uploadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
  uploadingText: { marginTop: 12, fontSize: 16, fontWeight: '600', color: '#00B2FF' },

  toolbar: { backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  toolbarContent: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  toolbarBtn: {
    backgroundColor: '#F8FAFC', paddingHorizontal: 12,
    minHeight: 44, justifyContent: 'center',
    borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0',
  },
  toolbarText: { fontSize: 13, fontWeight: '600', color: '#475569' },

  gridList: { padding: 12, paddingBottom: 100 },
  columnWrapper: { justifyContent: 'space-between', marginBottom: 12 },
  gridCard: {
    backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12,
    width: '48%', alignItems: 'center',
    borderWidth: 1, borderColor: '#F1F5F9',
  },
  gridIconContainer: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  gridThumbnail: { width: 64, height: 64, borderRadius: 8, backgroundColor: '#F1F5F9' },
  gridFileIcon: { fontSize: 40 },
  gridFileName: { fontSize: 13, fontWeight: '600', color: '#1E293B', textAlign: 'center', width: '100%' },
  gridFileMeta: { fontSize: 11, color: '#94A3B8', marginTop: 2 },

  progressBarContainer: {
    height: 4, backgroundColor: '#E2E8F0', borderRadius: 2,
    marginTop: 6, overflow: 'hidden', width: '100%',
  },
  progressBar: { height: '100%', backgroundColor: '#00B2FF' },
  gridProgressOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center', justifyContent: 'center', borderRadius: 8,
  },
  progressText: { fontSize: 10, fontWeight: '800', color: '#00B2FF' },
})