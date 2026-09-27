/*
 * Drama Mill — AI 短剧自动化生产平台 (https://github.com/your-org/drama-mill)
 * Copyright (C) 2026 Drama Mill <52859273@qq.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * 用户文件上传：图片 / 参考视频 / 参考音频 / 原始内容文档
 * 全部经 saveUploadedFile 落 uploads/{user_id}/ 租户目录；
 * 文档上传只做文本提取回显，落盘留档失败不阻断
 */
import { Hono } from 'hono'
import mammoth from 'mammoth'
import { success, badRequest } from '../utils/response.js'
import { saveUploadedFile, generateImageThumb } from '../utils/storage.js'

const app = new Hono()

/** 上传租户隔离段：落 `uploads/{user_id}/`，鉴权上下文缺失时回退 0 */
function uploadNested(c: any): string {
  return String((c.get('user') as { id?: number } | undefined)?.id ?? 0)
}

// POST /upload/image — 参考图/头像等图片上传，附带列表页缩略图
app.post('/image', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']

  if (!file || !(file instanceof File)) {
    return badRequest(c, 'file is required')
  }

  const buffer = await file.arrayBuffer()
  const path = await saveUploadedFile(buffer, 'uploads', file.name, uploadNested(c))
  // 上传图与生图共用一套展示链路：同步出缩略图，生成失败不影响上传本身
  await generateImageThumb(path)
  return success(c, { url: `/${path}`, path })
})

// 参考视频（Seedance 多模态参考）：扩展名 + MIME 双卡，50MB 上限
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v'])
const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'])
const VIDEO_MAX = 50 * 1024 * 1024 // 50MB

// 参考音频（Seedance 多模态参考）：20MB 上限
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac'])
const AUDIO_MIME = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac'])
const AUDIO_MAX = 20 * 1024 * 1024 // 20MB

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

const DOC_EXT = new Set(['.txt', '.md', '.docx'])
const DOC_MAX = 10 * 1024 * 1024 // 10MB

/** 编码自动识别：严格 UTF-8 解码失败则回退 GB18030（中文文档常见编码） */
function decodeTextBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('gb18030').decode(bytes)
  }
}

/** 去 BOM + 统一换行为 \n + 压缩连续空行 */
function normalizeText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// POST /upload/video
app.post('/video', async (c) => saveMediaUpload(c, 'video', VIDEO_EXT, VIDEO_MIME, VIDEO_MAX))

// POST /upload/audio
app.post('/audio', async (c) => saveMediaUpload(c, 'audio', AUDIO_EXT, AUDIO_MIME, AUDIO_MAX))

// 媒体上传通用校验：扩展名白名单 + MIME 双卡 + 体积上限
async function saveMediaUpload(
  c: any,
  kind: 'video' | 'audio',
  allowedExt: Set<string>,
  allowedMime: Set<string>,
  maxBytes: number,
) {
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) {
    return badRequest(c, 'file is required')
  }
  const label = kind === 'video' ? '视频' : '音频'
  const ext = extOf(file.name)
  // MIME 可伪造，扩展名兜底；空 / octet-stream 视为未知类型，仅按扩展名校验
  const mimeKnown = file.type && file.type !== 'application/octet-stream'
  if (!allowedExt.has(ext) || (mimeKnown && !allowedMime.has(file.type))) {
    return badRequest(c, `仅支持 ${Array.from(allowedExt).join('/')} 格式的${label}文件`)
  }
  const buffer = await file.arrayBuffer()
  if (buffer.byteLength > maxBytes) {
    return badRequest(c, `${label}文件大小不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB`)
  }
  const path = await saveUploadedFile(buffer, 'uploads', file.name, uploadNested(c))
  return success(c, { url: `/${path}`, path })
}

// POST /upload/document — 提取 .txt/.md/.docx 正文回给前端填"原始内容"
app.post('/document', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) return badRequest(c, 'file is required')
  const ext = extOf(file.name)
  if (!DOC_EXT.has(ext)) return badRequest(c, '仅支持 .txt / .md / .docx 格式的文件')
  const buffer = await file.arrayBuffer()
  if (buffer.byteLength > DOC_MAX) return badRequest(c, '文件大小不能超过 10MB')

  let text: string
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) })
    text = normalizeText(result.value || '')
  } else {
    text = normalizeText(decodeTextBuffer(buffer))
  }
  if (!text) return badRequest(c, '文件内容为空或无法解析')

  // 原文留档可追溯（落盘失败不影响文本返回）
  await saveUploadedFile(buffer, 'uploads', file.name, uploadNested(c)).catch(() => {})

  return success(c, { text, filename: file.name })
})

export default app
