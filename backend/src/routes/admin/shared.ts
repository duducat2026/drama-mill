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

import { db, schema } from '../../db/index.js'
// ─── 通用工具 ───

export function pageOf(c: any): { page: number; pageSize: number } {
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(c.req.query('page_size')) || 20))
  return { page, pageSize }
}

/** 深翻页封顶：offset 超过此值后索引序扫描成本线性失控，要求改用过滤条件收窄 */
export const MAX_PAGED_OFFSET = 50_000

/** 页码是否深到必须拒绝（千万级表 OFFSET 扫描的兜底防线） */
export function tooDeep(page: number, pageSize: number): boolean {
  return (page - 1) * pageSize > MAX_PAGED_OFFSET
}

export function paged<T>(rows: T[], page: number, pageSize: number) {
  return {
    total: rows.length,
    page,
    page_size: pageSize,
    items: rows.slice((page - 1) * pageSize, page * pageSize),
  }
}

/** 用户名检索 → id 集合（空关键词返回 null 表示不过滤） */
export async function userIdsByKeyword(keyword: string | undefined): Promise<Set<number> | null> {
  if (!keyword) return null
  const users = await db.select().from(schema.users)
  const kw = keyword.toLowerCase()
  return new Set(users.filter(u => u.username.toLowerCase().includes(kw) || (u.nickname || '').toLowerCase().includes(kw)).map(u => u.id))
}

export async function userMap(): Promise<Map<number, { username: string; nickname: string | null }>> {
  const users = await db.select({ id: schema.users.id, username: schema.users.username, nickname: schema.users.nickname }).from(schema.users)
  return new Map(users.map(u => [u.id, { username: u.username, nickname: u.nickname }]))
}

export async function dramaMap(): Promise<Map<number, { title: string }>> {
  const rows = await db.select({ id: schema.dramas.id, title: schema.dramas.title }).from(schema.dramas)
  return new Map(rows.map(d => [d.id, { title: d.title }]))
}

/** 日期区间过滤（ISO 字符串前缀比较，支持 yyyy-mm-dd 或完整时间） */
export function inDateRange(ts: string | null | undefined, from: string | undefined, to: string | undefined): boolean {
  if (!ts) return false
  if (from && ts < from) return false
  if (to && ts > `${to}\uFFFF`) return false
  return true
}

