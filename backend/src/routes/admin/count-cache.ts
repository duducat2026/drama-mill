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
 * 管理端大表列表 total 计数缓存 — 千万级下 COUNT(*) 是页码分页的固有最贵操作。
 *
 * 策略（沿用 storage-stats 的进程内缓存约定）：
 * - 按「路由 + 过滤条件」为 key 缓存 60 秒：翻页/刷新不重复计数，总数容忍分钟级陈旧；
 * - 并发同 key 请求共享同一趟 COUNT（inFlight 去重）；
 * - 条目封顶防爆：超限先清过期，仍超则逐出最旧。
 */

const COUNT_TTL_MS = 60_000
const MAX_ENTRIES = 200

const cache = new Map<string, { total: number; at: number }>()
const inFlight = new Map<string, Promise<number>>()

function evictIfNeeded() {
  if (cache.size < MAX_ENTRIES) return
  const now = Date.now()
  for (const [k, v] of cache) if (now - v.at >= COUNT_TTL_MS) cache.delete(k)
  while (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** total 计数（60s 缓存 + 并发去重）；key 必须编码全部影响行数的过滤条件，不含 page */
export async function cachedTotal(key: string, load: () => Promise<number>): Promise<number> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < COUNT_TTL_MS) return hit.total
  const flying = inFlight.get(key)
  if (flying) return flying
  const p = load()
    .then(total => {
      evictIfNeeded()
      cache.set(key, { total, at: Date.now() })
      return total
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}

/** 过滤条件 → 稳定缓存 key 片段（undefined/空串归一，防同义条件各占一条缓存） */
export function countKey(base: string, ...filters: (string | number | undefined)[]): string {
  return `${base}|${filters.map(f => (f === undefined || f === '' ? '_' : String(f))).join(':')}`
}
