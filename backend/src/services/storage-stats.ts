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
 * 存储统计服务 — 单遍文件系统遍历计算磁盘用量、分类大小/文件数、用户空间与最大文件
 *
 * 替代早期「du -sk 全分类 + 独立 countFiles 递归」的多趟遍历实现：
 * 每个分类目录只做一次递归（walkCategory），同趟聚合分类/用户/最大文件三类指标。
 *
 * 进程内 60 秒 TTL 缓存 + 并发请求去重（inFlight）：
 * 用户侧配额、管理侧存储页与运行监控共享同一份结果，避免重复探测大目录拖慢接口。
 *
 * 用户空间归属约定：分类根下一级数字目录即 user_id（多租户存储布局 {分类}/{user_id}/...），
 * 非数字一级目录（历史遗留平铺 / _orphan 等）不计入用户空间。
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { categoryDir, getStorageRoot } from '../utils/storage.js'
import { now } from '../utils/response.js'

const execFileAsync = promisify(execFile)

/** 计入统计的分类（key → 展示名），顺序即前端展示顺序 */
const CATEGORIES = [
  { key: 'images', label: '生成素材（图片）' },
  { key: 'videos', label: '视频片段' },
  { key: 'merged', label: '拼接成片' },
  { key: 'uploads', label: '用户上传' },
  { key: 'temp', label: '临时文件' },
] as const

/** 最大文件榜仅从视频/成片目录收集（图片/上传单文件普遍较小，上榜无意义） */
const TOP_FILES_CATEGORIES = new Set(['videos', 'merged'])
const TOP_FILES_LIMIT = 10

export interface DiskUsage {
  total_bytes: number
  used_bytes: number
  free_bytes: number
  used_percent: number
}

export interface StorageStats {
  disk: DiskUsage
  storage_root: string
  storage_total_bytes: number
  categories: { key: string; label: string; path: string; bytes: number; files: number }[]
  per_user: { user_id: number; total_bytes: number; per_category: Record<string, number> }[]
  top_files: { name: string; path: string; category: string; bytes: number }[]
  generated_at: string
}

// ─── 磁盘探测（df -kP POSIX 输出，跨 macOS/Linux 稳定） ─────────

const KB = 1024

export async function getDiskUsage(): Promise<DiskUsage> {
  try {
    const { stdout } = await execFileAsync('df', ['-kP', getStorageRoot()], { timeout: 10000 })
    const fields = stdout.trim().split('\n').slice(-1)[0].trim().split(/\s+/)
    // 1K-blocks Size Used Available Use% Mounted
    const total = (Number(fields[1]) || 0) * KB
    const used = (Number(fields[2]) || 0) * KB
    const free = (Number(fields[3]) || 0) * KB
    const used_percent = Number(String(fields[4]).replace('%', '')) || (total ? Math.round(used / total * 100) : 0)
    return { total_bytes: total, used_bytes: used, free_bytes: free, used_percent }
  } catch {
    return { total_bytes: 0, used_bytes: 0, free_bytes: 0, used_percent: 0 }
  }
}

// ─── 单遍遍历 ─────────────────────────────────────────────────

interface CategoryAgg { bytes: number; files: number }
interface UserAgg { total_bytes: number; per_category: Record<string, number> }
interface TopFile { name: string; path: string; category: string; bytes: number }

/** 递归累加单目录字节数与文件数（软链跳过、单项权限错误忽略，不中断整体遍历） */
function walkDir(dir: string): { bytes: number; files: number } {
  let bytes = 0
  let files = 0
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return { bytes, files }
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      const sub = walkDir(full)
      bytes += sub.bytes
      files += sub.files
    } else if (e.isFile()) {
      try {
        bytes += fs.statSync(full).size
        files++
      } catch {}
    }
  }
  return { bytes, files }
}

/** 维护降序最大文件榜（插入排序进定长数组，避免全量收集后排序） */
function pushTopFile(top: TopFile[], file: TopFile) {
  if (top.length < TOP_FILES_LIMIT) {
    top.push(file)
    let i = top.length - 1
    while (i > 0 && top[i - 1].bytes < top[i].bytes) {
      [top[i - 1], top[i]] = [top[i], top[i - 1]]
      i--
    }
    return
  }
  if (file.bytes <= top[top.length - 1].bytes) return
  top[top.length - 1] = file
  let i = top.length - 1
  while (i > 0 && top[i - 1].bytes < top[i].bytes) {
    [top[i - 1], top[i]] = [top[i], top[i - 1]]
    i--
  }
}

/**
 * 单分类一趟遍历：分类合计 + 用户一级目录聚合 + 最大文件榜。
 * 一级数字目录整体聚合（不再深入记账到用户以下层级），其余子树直接累加大小。
 */
function walkCategory(category: string, users: Map<number, UserAgg>, top: TopFile[]): CategoryAgg {
  const root = categoryDir(category)
  const agg: CategoryAgg = { bytes: 0, files: 0 }
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return agg
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue
    const full = path.join(root, e.name)
    if (e.isDirectory()) {
      const sub = walkDir(full)
      agg.bytes += sub.bytes
      agg.files += sub.files
      // 一级数字目录即 user_id，非数字（历史遗留/_orphan）不计入用户空间
      if (/^\d+$/.test(e.name)) {
        const uid = Number(e.name)
        const u = users.get(uid) || { total_bytes: 0, per_category: {} }
        u.total_bytes += sub.bytes
        u.per_category[category] = (u.per_category[category] || 0) + sub.bytes
        users.set(uid, u)
      }
    } else if (e.isFile()) {
      let size = 0
      try {
        size = fs.statSync(full).size
      } catch {
        continue
      }
      agg.bytes += size
      agg.files++
      if (TOP_FILES_CATEGORIES.has(category)) {
        pushTopFile(top, {
          name: e.name,
          path: path.relative(getStorageRoot(), full),
          category,
          bytes: size,
        })
      }
    }
  }
  return agg
}

async function computeStats(): Promise<StorageStats> {
  const storageRoot = getStorageRoot()
  const users = new Map<number, UserAgg>()
  const top: TopFile[] = []
  const categories = CATEGORIES.map((cat) => {
    const agg = walkCategory(cat.key, users, top)
    return { ...cat, path: categoryDir(cat.key), bytes: agg.bytes, files: agg.files }
  })
  return {
    disk: await getDiskUsage(),
    storage_root: storageRoot,
    storage_total_bytes: categories.reduce((s, c) => s + c.bytes, 0),
    categories,
    per_user: [...users.entries()]
      .map(([user_id, u]) => ({ user_id, total_bytes: u.total_bytes, per_category: u.per_category }))
      .sort((a, b) => b.total_bytes - a.total_bytes),
    top_files: top,
    generated_at: now(),
  }
}

// ─── 进程内 60s 缓存 + 并发去重 ────────────────────────────────

const CACHE_TTL_MS = 60_000
let cache: { stats: StorageStats; at: number } | null = null
let inFlight: Promise<StorageStats> | null = null

/** 存储统计（force=true 跳过缓存强制重算）；并发调用共享同一趟遍历 */
export async function getStorageStats(force = false): Promise<StorageStats> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.stats
  if (!force && inFlight) return inFlight
  const task = (async () => {
    const stats = await computeStats()
    cache = { stats, at: Date.now() }
    return stats
  })()
    .finally(() => {
      if (inFlight === task) inFlight = null
    })
  if (!force) {
    inFlight = task
  }
  return task
}
