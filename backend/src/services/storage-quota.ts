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
 * 用户存储配额与用量 —
 * 全局默认配额由环境变量 STORAGE_QUOTA_GB 控制（默认 1，单位 GB）；
 * 按用户覆盖存 users.storage_quota_bytes（NULL/0 表示沿用全局默认）。
 * 用量按多租户目录 {分类根}/{user_id}/ 用 du 探测，进程内 60 秒 TTL 缓存，
 * 用户侧/管理侧多个入口共享同一缓存，避免重复探测大目录。
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { categoryDir } from '../utils/storage.js'

const execFileAsync = promisify(execFile)

const GB = 1024 ** 3

/** 全局默认配额（字节）：STORAGE_QUOTA_GB 未配置/非法时回退 1GB */
export function defaultQuotaBytes(): number {
  const gb = Number(process.env.STORAGE_QUOTA_GB)
  return (Number.isFinite(gb) && gb > 0 ? gb : 1) * GB
}

/** 生效配额：按用户覆盖值优先，未配置/非正值回退全局默认 */
export function quotaOf(storageQuotaBytes: number | null | undefined): number {
  return storageQuotaBytes != null && storageQuotaBytes > 0 ? storageQuotaBytes : defaultQuotaBytes()
}

/** 计入配额的分类目录（临时文件不计） */
const USAGE_CATEGORIES = ['images', 'videos', 'merged', 'uploads']

const USAGE_TTL_MS = 60_000
const usageCache = new Map<number, { bytes: number; at: number }>()

async function dirBytes(dir: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('du', ['-sk', dir], { timeout: 60000 })
    return (Number(stdout.trim().split(/\s+/)[0]) || 0) * 1024
  } catch {
    return 0
  }
}

/** 单用户存储用量（四个分类目录合计），60 秒 TTL 缓存 */
export async function getUserUsageBytes(userId: number): Promise<number> {
  const hit = usageCache.get(userId)
  if (hit && Date.now() - hit.at < USAGE_TTL_MS) return hit.bytes
  const parts = await Promise.all(USAGE_CATEGORIES.map(cat => dirBytes(path.join(categoryDir(cat), String(userId)))))
  const bytes = parts.reduce((s, b) => s + b, 0)
  usageCache.set(userId, { bytes, at: Date.now() })
  return bytes
}

/** 用户配额状态：用量/生效配额/是否超额/百分比（供用户侧接口） */
export async function getUserQuotaStatus(userId: number): Promise<{
  used_bytes: number
  quota_bytes: number
  default_quota_bytes: number
  custom_quota: boolean
  exceeded: boolean
  percent: number
}> {
  const [user] = await db.select({ storageQuotaBytes: schema.users.storageQuotaBytes }).from(schema.users).where(eq(schema.users.id, userId))
  const custom = user?.storageQuotaBytes != null && user.storageQuotaBytes > 0
  const quota = quotaOf(user?.storageQuotaBytes)
  const used = await getUserUsageBytes(userId)
  return {
    used_bytes: used,
    quota_bytes: quota,
    default_quota_bytes: defaultQuotaBytes(),
    custom_quota: custom,
    exceeded: used > quota,
    percent: quota ? +(used / quota * 100).toFixed(1) : 0,
  }
}

/** 超额用户清单（管理侧告警）：全量用户逐个取缓存用量，过滤超额者按用量降序 */
export async function getOverQuotaUsers(): Promise<{ user_id: number; username: string; used_bytes: number; quota_bytes: number }[]> {
  const users = await db.select({
    id: schema.users.id,
    username: schema.users.username,
    nickname: schema.users.nickname,
    storageQuotaBytes: schema.users.storageQuotaBytes,
  }).from(schema.users)
  const rows = await Promise.all(users.map(async (u) => {
    const quota = quotaOf(u.storageQuotaBytes)
    const used = await getUserUsageBytes(u.id)
    return { user_id: u.id, username: u.nickname || u.username, used_bytes: used, quota_bytes: quota }
  }))
  return rows.filter(r => r.used_bytes > r.quota_bytes).sort((a, b) => b.used_bytes - a.used_bytes)
}
