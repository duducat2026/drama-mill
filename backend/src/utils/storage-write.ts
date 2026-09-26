/*
 * Drama Mill — 文件存储写入：远程下载 / 上传落盘 / Base64 图片保存
 */
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import {
  getExtFromUrl,
  mimeTypeToExt,
  resolveCategoryPath,
  staticRelPath,
} from './storage-core.js'

/**
 * 下载远程文件到本地存储
 */
export async function downloadFile(url: string, subDir: string, nestedPath = ''): Promise<string> {
  const dir = resolveCategoryPath(subDir, nestedPath)
  fs.mkdirSync(dir, { recursive: true })

  const ext = getExtFromUrl(url)
  const filename = `${uuid()}${ext}`
  const filePath = path.join(dir, filename)

  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`)

  const buffer = Buffer.from(await resp.arrayBuffer())
  fs.writeFileSync(filePath, buffer)

  // 返回相对路径（供 API 返回给前端）
  return staticRelPath(subDir, nestedPath, filename)
}

/**
 * 保存上传的文件
 */
export async function saveUploadedFile(data: ArrayBuffer, subDir: string, originalName: string, nestedPath = ''): Promise<string> {
  const dir = resolveCategoryPath(subDir, nestedPath)
  fs.mkdirSync(dir, { recursive: true })

  const ext = path.extname(originalName) || '.bin'
  const filename = `${uuid()}${ext}`
  const filePath = path.join(dir, filename)

  fs.writeFileSync(filePath, Buffer.from(data))
  return staticRelPath(subDir, nestedPath, filename)
}

/**
 * 保存 Base64 编码的图片数据到本地存储
 * 用于 Gemini 等只返回 base64 数据的厂商
 */
export async function saveBase64Image(base64Data: string, mimeType: string, subDir: string, nestedPath = ''): Promise<string> {
  const dir = resolveCategoryPath(subDir, nestedPath)
  fs.mkdirSync(dir, { recursive: true })

  // 从 mimeType 推断文件扩展名
  const ext = mimeTypeToExt(mimeType)
  const filename = `${uuid()}${ext}`
  const filePath = path.join(dir, filename)

  const buffer = Buffer.from(base64Data, 'base64')
  fs.writeFileSync(filePath, buffer)

  return staticRelPath(subDir, nestedPath, filename)
}
