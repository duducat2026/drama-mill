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
 * 项目路由共享层 — dramas.ts / dramas-assets.ts 公用的纯函数与聚合查询
 */
import { and, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db/index.js'

/** metadata 统一以 JSON 字符串落库：对象自动序列化，字符串直通（兼容旧调用方） */
export function normalizeMetadata(value: any): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

/** 按 drama_id 批量聚合计数（替代逐项目 N+1 查询）；返回 dramaId -> count 映射 */
export async function countByDrama(table: any, dramaIds: number[], filterDeleted: boolean) {
  const map = new Map<number, number>()
  if (!dramaIds.length) return map
  const conds: any[] = [inArray(table.dramaId, dramaIds)]
  if (filterDeleted) conds.push(isNull(table.deletedAt))
  const rows = await db.select({ dramaId: table.dramaId, count: sql<number>`COUNT(*)` })
    .from(table).where(and(...conds)).groupBy(table.dramaId)
  for (const r of rows) map.set(r.dramaId, Number(r.count))
  return map
}

/** summary 模式下剔除素材的大字段（参考图/种子值），其余字段保留 */
export function stripAssetHeavy(rows: any[]) {
  return rows.map(r => {
    const { referenceImages, seedValue, ...rest } = r
    return rest
  })
}

