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
 * 生成任务参考素材归一化 — 从 generation.ts 拆出：
 * 图片/视频参考图统一转 base64 data URL（本地 static 压缩读取、远程下载、历史落盘回退），
 * 以及参考视频/音频的公网 URL 解析（Seedance 需要可公网访问的地址）。
 */
import { db, schema } from '../db/index.js'
import { and, eq, like } from 'drizzle-orm'
import { fetchRemoteImageAsCompressedDataUrl, readImageAsCompressedDataUrl } from '../utils/storage.js'
import { logTaskWarn, redactUrl } from '../utils/task-logger.js'

const REF_IMAGE_OPTIONS = { maxWidth: 768, maxHeight: 768, quality: 68 } as const

async function readLocalRefImage(value: string, taskLabel: 'ImageTask' | 'VideoTask'): Promise<string | null> {
  const localPath = value.startsWith('/static/') ? value.slice(1) : value
  try {
    return await readImageAsCompressedDataUrl(localPath, REF_IMAGE_OPTIONS)
  } catch (err) {
    logTaskWarn(taskLabel, 'reference-read-failed', { path: localPath, error: (err as Error).message })
    return null
  }
}

/** 远程参考图下载转 base64；失败时从 sys_task 历史落盘文件回退 */
async function resolveRemoteRefImage(url: string, taskLabel: 'ImageTask' | 'VideoTask'): Promise<string | null> {
  const dataUrl = await fetchRemoteImageAsCompressedDataUrl(url, REF_IMAGE_OPTIONS)
  if (dataUrl) return dataUrl
  // 远程下载失败：尝试从 sys_task 历史中查找本地落盘文件回退
  const localPath = await findLocalPathForRemoteUrl(url)
  if (localPath) {
    try {
      const fallback = await readImageAsCompressedDataUrl(localPath, REF_IMAGE_OPTIONS)
      logTaskWarn(taskLabel, 'reference-local-fallback', { url: redactUrl(url), localPath })
      return fallback
    } catch (err) {
      logTaskWarn(taskLabel, 'reference-local-fallback-failed', { path: localPath, error: (err as Error).message })
    }
  }
  logTaskWarn(taskLabel, 'reference-download-failed', { url: redactUrl(url) })
  return null
}

async function normalizeRefValue(value: string, taskLabel: 'ImageTask' | 'VideoTask'): Promise<string | null> {
  if (value.startsWith('data:image/')) return value
  if (value.startsWith('static/') || value.startsWith('/static/')) return readLocalRefImage(value, taskLabel)
  // 外部 http(s) URL：下载并转为 base64，避免 OSS 签名过期
  if (value.startsWith('http://') || value.startsWith('https://')) return resolveRemoteRefImage(value, taskLabel)
  return value
}

export async function normalizeReferenceImages(refs: string[] | null | undefined): Promise<string[]> {
  if (!Array.isArray(refs) || !refs.length) return []

  const deduped = Array.from(
    new Set(
      refs
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  )

  const normalized = await Promise.all(deduped.map((value) => normalizeRefValue(value, 'ImageTask')))
  return normalized.filter((item): item is string => !!item).slice(0, 6)
}

/**
 * 远程 URL 下载失败时，尝试从 sys_task 历史记录中查找该 URL 对应的本地落盘文件。
 * 匹配策略：去掉查询参数后的 base URL 前缀匹配（OSS 签名每次不同，但路径一致）。
 * 注意：URL 中的 %XX 编码需转义，避免被 SQL LIKE 当成通配符。
 */
async function findLocalPathForRemoteUrl(url: string): Promise<string | null> {
  try {
    // 去掉查询参数，取 base URL 用于前缀匹配
    const baseUrl = url.split('?')[0]
    if (!baseUrl) return null
    // 转义 LIKE 通配符：URL 中的 %2F 等编码会被 SQL 误当成 % 匹配任意字符
    const escaped = baseUrl.replace(/%/g, '\\%').replace(/_/g, '\\_')
    const rows = await db.select({ localPath: schema.sysTask.localPath })
      .from(schema.sysTask)
      .where(and(
        eq(schema.sysTask.type, 'image'),
        eq(schema.sysTask.status, 'completed'),
        like(schema.sysTask.resultUrl, `${escaped}%`),
      ))
      .limit(1)
    const localPath = rows[0]?.localPath
    if (localPath && (localPath.startsWith('static/') || localPath.startsWith('/static/'))) {
      return localPath
    }
    return null
  } catch {
    return null
  }
}

export async function normalizeVideoReferenceUrl(value: string | null | undefined): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  return normalizeRefValue(raw, 'VideoTask')
}

export async function normalizeVideoReferenceUrls(refs: string[] | null | undefined): Promise<string[]> {
  if (!Array.isArray(refs) || !refs.length) return []
  const normalized = await Promise.all(
    Array.from(new Set(refs.map((item) => String(item || '').trim()).filter(Boolean))).map((item) => normalizeVideoReferenceUrl(item)),
  )
  return normalized.filter((item): item is string => !!item)
}

/**
 * 将参考视频/音频解析为 Seedance API 可访问的 URL。
 * http(s)/dataURL 直通；本地 static 路径需要 PUBLIC_BASE_URL 拼成公网地址，
 * 未配置时抛出可操作的中文错误（落入 catch 写入 error_msg 供前端展示）。
 */
function resolvePublicMediaUrl(value: string | null | undefined, kind: 'video' | 'audio'): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')) return raw
  if (raw.startsWith('static/') || raw.startsWith('/static/')) {
    const base = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
    if (!base) {
      const label = kind === 'video' ? '视频' : '音频'
      throw new Error(
        `参考${label}为本地路径 ${raw}，但后端未配置 PUBLIC_BASE_URL，Seedance API 无法访问内网地址。` +
        `请在 backend/.env 配置 PUBLIC_BASE_URL（如 https://your-domain.com）后重试，或改用公网 URL。`,
      )
    }
    const p = raw.startsWith('/') ? raw : `/${raw}`
    return `${base}${p}`
  }
  return raw
}

export function resolvePublicMediaUrls(refs: string[] | null | undefined, kind: 'video' | 'audio'): string[] {
  if (!Array.isArray(refs) || !refs.length) return []
  const items = Array.from(new Set(refs.map((item) => String(item || '').trim()).filter(Boolean)))
  return items.map((item) => resolvePublicMediaUrl(item, kind)).filter((item): item is string => !!item)
}
