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
 * 成本查价服务 — 计价优先级：用户级模型价（user_model_prices，按 user_id+model）
 * → 平台刊例价（model_prices，provider|model 精确 → model 名回退，兼容 OpenAI 兼容网关）。
 * 两级均 60s 内存缓存，避免每次模型调用查库。
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

export interface PriceRow {
  billingType: string
  inputPrice: number | null
  outputPrice: number | null
  unitPrice: number | null
}

const TTL_MS = 60_000

// 平台刊例价缓存：exact = provider|model，byModel = model 名回退
let priceCache: Map<string, PriceRow> | null = null
let modelCache: Map<string, PriceRow> | null = null
let priceCacheAt = 0

// 用户价缓存：userId → { at, byModel }
const userCache = new Map<number, { at: number; byModel: Map<string, PriceRow> }>()

function toPriceRow(r: { billingType: string; inputPrice: number | null; outputPrice: number | null; unitPrice: number | null }): PriceRow {
  return { billingType: r.billingType, inputPrice: r.inputPrice, outputPrice: r.outputPrice, unitPrice: r.unitPrice }
}

async function getPlatformMaps(): Promise<{ exact: Map<string, PriceRow>; byModel: Map<string, PriceRow> }> {
  if (priceCache && modelCache && Date.now() - priceCacheAt < TTL_MS) return { exact: priceCache, byModel: modelCache }
  const rows = await db.select().from(schema.modelPrices)
  priceCache = new Map(rows.map(r => [`${r.provider}|${r.model}`, toPriceRow(r)]))
  modelCache = new Map(rows.map(r => [r.model, toPriceRow(r)]))
  priceCacheAt = Date.now()
  return { exact: priceCache, byModel: modelCache }
}

async function getUserMap(userId: number): Promise<Map<string, PriceRow>> {
  const hit = userCache.get(userId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.byModel
  const rows = await db.select().from(schema.userModelPrices).where(eq(schema.userModelPrices.userId, userId))
  const byModel = new Map(rows.map(r => [r.model, toPriceRow(r)]))
  userCache.set(userId, { at: Date.now(), byModel })
  return byModel
}

/** 查价：用户价命中优先；否则平台价 provider|model 精确 → 模型名回退 */
export async function lookupPrice(
  provider: string | null | undefined,
  model: string | null | undefined,
  userId?: number | null,
): Promise<PriceRow | undefined> {
  if (!model) return undefined
  if (userId) {
    const userRow = (await getUserMap(userId)).get(model)
    if (userRow) return userRow
  }
  const { exact, byModel } = await getPlatformMaps()
  return (provider ? exact.get(`${provider}|${model}`) : undefined) ?? byModel.get(model)
}

/** 价格改动后的缓存失效：无参清全部平台价；带 userId 清单个用户价 */
export function invalidatePriceCache(userId?: number) {
  if (userId === undefined) { priceCache = null; modelCache = null; priceCacheAt = 0 }
  else userCache.delete(userId)
}
