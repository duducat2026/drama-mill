/*
 * Drama Mill — 文件存储核心：分类根目录收口 / 路径解析 / 生命周期回收 / 类型映射
 * 各分类目录可用环境变量指向项目目录之外的独立磁盘/目录，相对路径格式 `static/xxx/...` 不变
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')

// 分类根目录：默认在 STORAGE_ROOT 下，可单独外挂卷/目录指向（素材不进构建上下文）
const CATEGORY_DIRS: Record<string, string> = {
  images: process.env.ASSET_PATH || path.join(STORAGE_ROOT, 'images'),    // 图片素材库（资产形象图/生成图）
  videos: process.env.VIDEO_PATH || path.join(STORAGE_ROOT, 'videos'),    // 视频片段（镜头生成产物）
  merged: process.env.MERGED_PATH || path.join(STORAGE_ROOT, 'merged'),   // 拼接成片
  uploads: process.env.UPLOAD_PATH || path.join(STORAGE_ROOT, 'uploads'), // 上传素材/原文留档
}

/** 分类子目录对应的实际存储根；未分类目录回退 STORAGE_ROOT（兼容 temp 等） */
export function categoryDir(subDir: string): string {
  return CATEGORY_DIRS[subDir] || path.join(STORAGE_ROOT, subDir)
}

/** 分类根下的嵌套目录（经 categoryDir 解析，保证 ASSET_PATH/VIDEO_PATH 等外挂卷环境变量对嵌套路径同样生效） */
export function resolveCategoryPath(category: string, nested = ''): string {
  return nested ? path.join(categoryDir(category), nested) : categoryDir(category)
}

/** 多租户嵌套相对段：`{user_id}/{drama_id}`；缺失时回退 `0` / `unassigned` */
export function tenantNestedPath(userId: number | null | undefined, dramaId: number | null | undefined): string {
  return `${userId ?? 0}/${dramaId ?? 'unassigned'}`
}

/** 多租户分层目录：`{分类根}/{user_id}/{drama_id}`（租户一级隔离配额/清理，剧集二级隔离回收/排查） */
export function buildAssetDir(category: string, userId: number | null | undefined, dramaId: number | null | undefined): string {
  return resolveCategoryPath(category, tenantNestedPath(userId, dramaId))
}

/** 落盘相对路径：`static/{分类}[/{嵌套}]/{文件名}`，与 getAbsolutePath 的分类前缀解析对应 */
export function staticRelPath(subDir: string, nestedPath: string, filename: string): string {
  return `static/${subDir}${nestedPath ? `/${nestedPath}` : ''}/${filename}`
}

/** 存储根目录（未分类文件、临时文件用） */
export function getStorageRoot(): string {
  return STORAGE_ROOT
}

/** 回收剧集存储目录：删除三个内容分类下的 `{user_id}/{drama_id}/`（供硬删入口接入；软删不触发） */
export function removeDramaStorage(userId: number | null | undefined, dramaId: number | null | undefined): void {
  if (dramaId == null) return
  for (const category of ['images', 'videos', 'merged']) {
    const dir = buildAssetDir(category, userId, dramaId)
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** 回收用户存储目录：三个内容分类下的 `{user_id}/` 及 `uploads/{user_id}/`（供用户注销接入） */
export function removeUserStorage(userId: number): void {
  for (const category of ['images', 'videos', 'merged', 'uploads']) {
    const dir = path.join(categoryDir(category), String(userId))
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

export function getExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const ext = path.extname(pathname)
    if (ext && ext.length <= 5) return ext
  } catch {}
  return '.bin'
}

/**
 * 获取本地文件的绝对路径：`static/<分类>/...` 按分类根目录解析（目录可在项目外），
 * 其余相对路径回退 STORAGE_ROOT；绝对路径原样返回（兼容外部配置目录）
 */
export function getAbsolutePath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath
  if (relativePath.startsWith('static/')) {
    const rest = relativePath.slice('static/'.length)
    const subDir = rest.split('/')[0]
    if (subDir && CATEGORY_DIRS[subDir]) {
      return path.join(CATEGORY_DIRS[subDir], rest.slice(subDir.length + 1))
    }
  }
  return path.join(STORAGE_ROOT, relativePath)
}

/**
 * /static/* 请求收口解析：按分类前缀映射到实际文件路径；
 * 目录穿越/不存在/非文件一律返回 null（调用方 404）
 */
export function resolveStaticFile(reqPath: string): { abs: string; contentType: string } | null {
  const rel = reqPath.replace(/^\/+/, '')
  if (!rel.startsWith('static/')) return null
  if (rel.split('/').some(seg => seg === '..' || seg === '.' || seg === '')) return null
  const abs = path.normalize(getAbsolutePath(rel))
  try {
    if (!fs.statSync(abs).isFile()) return null
  } catch {
    return null
  }
  return { abs, contentType: extToContentType(path.extname(abs).toLowerCase()) }
}

/** 本地存储文件大小（字节）；路径为空/文件不存在时返回 null（前端据此不展示） */
export function localFileSize(relativePath: string | null | undefined): number | null {
  if (!relativePath) return null
  try {
    return fs.statSync(getAbsolutePath(relativePath)).size
  } catch {
    return null
  }
}

/** 由图片相对路径推导缩略图路径：static/images/x.png → static/images/x_thumb.webp */
export function thumbPathFor(relativePath: string): string {
  return relativePath.replace(/\.[^./]+$/, '_thumb.webp')
}

export function mimeTypeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
  }
  return map[mimeType] || '.png'
}

export function extToMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }
  return map[ext] || 'image/png'
}

/** 静态服务 Content-Type：覆盖图片/视频/音频/文档，未知类型走二进制流 */
export function extToContentType(ext: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.m4v': 'video/x-m4v',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/plain; charset=utf-8',
    '.docx': 'application/octet-stream',
  }
  return map[ext] || 'application/octet-stream'
}
