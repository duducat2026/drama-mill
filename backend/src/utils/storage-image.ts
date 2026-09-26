/*
 * Drama Mill — 图片处理：缩略图生成 / data URL 读取压缩 / 远程图片压缩 / dataURL 解析
 */
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { extToMimeType, getAbsolutePath, thumbPathFor } from './storage-core.js'

/**
 * 为已落盘图片生成列表页缩略图（宽 400 WebP，与原图同目录）。
 * 失败（文件损坏/格式异常等）返回 null，不阻断主流程。
 */
export async function generateImageThumb(relativePath: string): Promise<string | null> {
  try {
    const thumbRel = thumbPathFor(relativePath)
    await sharp(getAbsolutePath(relativePath))
      .rotate()
      .resize({ width: 400, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(getAbsolutePath(thumbRel))
    return thumbRel
  } catch (err) {
    console.warn(`[storage] 缩略图生成失败 ${relativePath}:`, (err as Error).message)
    return null
  }
}

export function readImageAsDataUrl(relativePath: string): string {
  const filePath = getAbsolutePath(relativePath)
  const buffer = fs.readFileSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const mimeType = extToMimeType(ext)
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

export async function readImageAsCompressedDataUrl(
  relativePath: string,
  options: {
    maxWidth?: number
    maxHeight?: number
    quality?: number
  } = {},
): Promise<string> {
  const filePath = getAbsolutePath(relativePath)
  const maxWidth = options.maxWidth ?? 768
  const maxHeight = options.maxHeight ?? 768
  const quality = options.quality ?? 68

  const resized = sharp(filePath).rotate().resize({
    width: maxWidth,
    height: maxHeight,
    fit: 'inside',
    withoutEnlargement: true,
  })
  const metadata = await resized.metadata()
  const output = metadata.hasAlpha
    ? await resized.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer()
    : await resized.jpeg({ quality, mozjpeg: true }).toBuffer()
  const mimeType = 'image/jpeg'
  return `data:${mimeType};base64,${output.toString('base64')}`
}

/**
 * 下载远程图片并压缩为 JPEG base64 data URL（用于视频/图片生成的参考素材）。
 * 解决 OSS 签名 URL 过期导致上游 API 下载失败的问题。
 * 失败返回 null（调用方过滤掉该素材，不阻断主流程）。
 */
export async function fetchRemoteImageAsCompressedDataUrl(
  url: string,
  options: {
    maxWidth?: number
    maxHeight?: number
    quality?: number
  } = {},
): Promise<string | null> {
  const maxWidth = options.maxWidth ?? 768
  const maxHeight = options.maxHeight ?? 768
  const quality = options.quality ?? 68

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!resp.ok) return null
    const buffer = Buffer.from(await resp.arrayBuffer())
    const resized = sharp(buffer).rotate().resize({
      width: maxWidth,
      height: maxHeight,
      fit: 'inside',
      withoutEnlargement: true,
    })
    const metadata = await resized.metadata()
    const output = metadata.hasAlpha
      ? await resized.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer()
      : await resized.jpeg({ quality, mozjpeg: true }).toBuffer()
    return `data:image/jpeg;base64,${output.toString('base64')}`
  } catch {
    return null
  }
}

export function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  return {
    mimeType: match[1],
    data: match[2],
  }
}
