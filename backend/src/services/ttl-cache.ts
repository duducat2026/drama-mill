/*
 * Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
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
 * 小表全量列表的进程内 TTL 缓存 — 风格预设 / 拆分模版等公共表"极少改、每请求读"专用。
 *
 * 约定（沿用 count-cache / cost-price-lookup 的缓存语义）：
 * - 60 秒容忍陈旧；并发同 key 请求共享同一趟查询（in-flight 去重）；
 * - invalidate 带代际号：失效瞬间在途的 load 完成后不回写脏数据；
 * - 全表缓存仅适用于行数有界的小表（几十~几百行），大表禁用。
 */

const DEFAULT_TTL_MS = 60_000

export function createTtlListCache<T>(load: () => Promise<T[]>, ttlMs: number = DEFAULT_TTL_MS) {
  let cache: { rows: T[]; at: number } | null = null
  let inFlight: Promise<T[]> | null = null
  let gen = 0

  return {
    async get(): Promise<T[]> {
      if (cache && Date.now() - cache.at < ttlMs) return cache.rows
      if (inFlight) return inFlight
      const g = gen
      inFlight = load()
        .then(rows => {
          // 代际未变才回写：invalidate 之后完成的旧结果不得污染缓存
          if (gen === g) cache = { rows, at: Date.now() }
          return rows
        })
        .finally(() => { inFlight = null })
      return inFlight
    },
    invalidate() {
      gen++
      cache = null
      inFlight = null
    },
  }
}
