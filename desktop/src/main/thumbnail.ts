import { Jimp } from 'jimp'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const CACHE_DIR = path.join(app.getPath('userData'), 'thumbnails-cache')
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
}

const THUMBNAIL_SIZE = 256

// Format ที่ sharp รองรับ (รวม format ที่ Jimp ไม่รองรับ)
const SHARP_SUPPORTED = [
  'image/avif',
  'image/svg+xml',
  'image/heic',
  'image/heif',
  'image/tiff',
  'image/bmp',
  'image/x-bmp',
  'image/vnd.microsoft.icon',
  'image/x-icon',
  'image/webp',
]

// Format ที่ Jimp รองรับ
const JIMP_SUPPORTED = [
  'image/jpeg',
  'image/png',
  'image/gif',
]

async function generateWithSharp(filePath: string): Promise<Buffer | null> {
  try {
    const sharp = (await import('sharp')).default
    const buffer = await sharp(filePath)
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
        fit: 'cover',
        position: 'centre',
      })
      .jpeg({ quality: 80 })
      .toBuffer()
    return buffer
  } catch (err) {
    console.warn(`[Thumbnail] sharp failed for ${filePath}:`, err)
    return null
  }
}

async function generateWithJimp(filePath: string): Promise<Buffer | null> {
  try {
    const image = await Jimp.read(filePath)
    image.cover({ w: THUMBNAIL_SIZE, h: THUMBNAIL_SIZE })
    return await image.getBuffer('image/jpeg')
  } catch (err) {
    console.warn(`[Thumbnail] Jimp failed for ${filePath}:`, err)
    return null
  }
}

async function generateImageThumbnail(filePath: string, mimeType: string): Promise<Buffer | null> {
  // ลอง sharp ก่อนเสมอ (รองรับ format ได้มากกว่า)
  if (SHARP_SUPPORTED.includes(mimeType)) {
    const result = await generateWithSharp(filePath)
    if (result) return result
  }

  // Jimp สำหรับ format พื้นฐาน
  if (JIMP_SUPPORTED.includes(mimeType)) {
    const result = await generateWithJimp(filePath)
    if (result) return result
  }

  // Fallback: ลอง sharp กับทุก format ที่ไม่รู้จัก
  if (!SHARP_SUPPORTED.includes(mimeType) && !JIMP_SUPPORTED.includes(mimeType)) {
    console.warn(`[Thumbnail] Unknown image MIME type "${mimeType}", trying sharp as fallback`)
    return await generateWithSharp(filePath)
  }

  // ถ้าทุกวิธีล้มเหลว → return null (UI จะแสดง default icon)
  console.warn(`[Thumbnail] All methods failed for ${filePath}, caller should use default icon`)
  return null
}

async function generatePdfThumbnail(filePath: string): Promise<Buffer | null> {
  try {
    const { pdf } = await import('pdf-to-img')

    const doc = await pdf(filePath, { scale: 1 })

    // เอาแค่หน้าแรก
    let firstPage: Buffer | null = null
    for await (const page of doc) {
      firstPage = page
      break
    }

    if (!firstPage) return null

    // Resize ให้ได้ขนาด thumbnail
    const sharp = (await import('sharp')).default
    return await sharp(firstPage)
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toBuffer()

  } catch (err) {
    console.warn(`[Thumbnail] PDF render failed for ${filePath}:`, err)
    return null
  }
}

export async function generateThumbnail(
  filePath: string,
  mimeType: string,
  fileId: string
): Promise<Buffer | null> {
  const cachePath = path.join(CACHE_DIR, `${fileId}.jpg`)

  try {
    // 1. Check cache ก่อน
    if (fs.existsSync(cachePath)) {
      return fs.readFileSync(cachePath)
    }

    let buffer: Buffer | null = null

    if (mimeType.startsWith('image/')) {
      buffer = await generateImageThumbnail(filePath, mimeType)
    } else if (mimeType === 'application/pdf') {
      buffer = await generatePdfThumbnail(filePath)
    }

    // 2. บันทึก cache ถ้าสำเร็จ
    if (buffer) {
      fs.writeFileSync(cachePath, buffer)
      return buffer
    }

    // 3. return null → UI แสดง default icon แทน
    return null
  } catch (err) {
    console.error(`[Thumbnail] Unexpected error for ${filePath}:`, err)
    return null
  }
}