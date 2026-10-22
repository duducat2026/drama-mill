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
 * → 平台目录价（model_catalog_* 实时派生，目录价即刊例价：provider|model 精确 → model 名回退）
 * → 历史刊例表 model_prices（种子/旧导入遗留，兼容兜底）。
 * 各级均 60s 内存缓存，避免每次模型调用查库。
 * 网关配置惯用 `厂商/模型` 形态（如 qwen/wan2.7-image），各级原名均未命中时剥离前导厂商段回退重查。
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { deriveCatalogPlans } from './model-catalog-price.js'

export interface PriceRow {
  billingType: string
  inputPrice: number | null
  outputPrice: number | null
  unitPrice: number | null
}

const TTL_MS = 60_000

// 平台刊例价缓存（历史 model_prices 表）：exact = provider|model，byModel = model 名回退
let priceCache: Map<string, PriceRow> | null = null
let modelCache: Map<string, PriceRow> | null = null
let priceCacheAt = 0

// 目录价派生缓存（主）：exact/byModel 同上口径，来自 model_catalog_prices 聚合
let catalogExact: Map<string, PriceRow> | null = null
let catalogByModel: Map<string, PriceRow> | null = null
let catalogCacheAt = 0

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

/** 目录价即刊例价：从 model_catalog_prices 聚合派生（provider 取目录厂商，model 取 model_id） */
async function getCatalogMaps(): Promise<{ exact: Map<string, PriceRow>; byModel: Map<string, PriceRow> }> {
  if (catalogExact && catalogByModel && Date.now() - catalogCacheAt < TTL_MS) return { exact: catalogExact, byModel: catalogByModel }
  const plans = await deriveCatalogPlans()
  catalogExact = new Map(plans.map(p => [`${p.provider}|${p.model}`, toPriceRow({ billingType: p.billing_type, inputPrice: p.input_price, outputPrice: p.output_price, unitPrice: p.unit_price })]))
  catalogByModel = new Map(plans.map(p => [p.model, toPriceRow({ billingType: p.billing_type, inputPrice: p.input_price, outputPrice: p.output_price, unitPrice: p.unit_price })]))
  catalogCacheAt = Date.now()
  return { exact: catalogExact, byModel: catalogByModel }
}

async function getUserMap(userId: number): Promise<Map<string, PriceRow>> {
  const hit = userCache.get(userId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.byModel
  const rows = await db.select().from(schema.userModelPrices).where(eq(schema.userModelPrices.userId, userId))
  const byModel = new Map(rows.map(r => [r.model, toPriceRow(r)]))
  userCache.set(userId, { at: Date.now(), byModel })
  return byModel
}

/** 查价：用户价命中优先；否则目录价（provider|model 精确 → 模型名回退）；再兜底历史 model_prices；
 *  原名各级均未命中且含 "/" 时，剥离前导厂商段用裸模型名重查（不先试裸名，保前缀价精度） */
export async function lookupPrice(
  provider: string | null | undefined,
  model: string | null | undefined,
  userId?: number | null,
): Promise<PriceRow | undefined> {
  if (!model) return undefined
  const row = await lookupByModel(provider, model, userId)
  if (row) return row
  const bare = stripVendorPrefix(model)
  return bare ? lookupByModel(provider, bare, userId) : undefined
}

/** 剥离前导厂商段：qwen/wan2.7-image → wan2.7-image；无斜杠或以"/"结尾返回 undefined */
function stripVendorPrefix(model: string): string | undefined {
  const idx = model.indexOf('/')
  return idx > 0 && idx < model.length - 1 ? model.slice(idx + 1) : undefined
}

async function lookupByModel(
  provider: string | null | undefined,
  model: string,
  userId?: number | null,
): Promise<PriceRow | undefined> {
  if (userId) {
    const userRow = (await getUserMap(userId)).get(model)
    if (userRow) return userRow
  }
  const cat = await getCatalogMaps()
  const catalogRow = (provider ? cat.exact.get(`${provider}|${model}`) : undefined) ?? cat.byModel.get(model)
  if (catalogRow) return catalogRow
  const { exact, byModel } = await getPlatformMaps()
  return (provider ? exact.get(`${provider}|${model}`) : undefined) ?? byModel.get(model)
}

/** 价格改动后的缓存失效：无参清平台价（含目录派生）；带 userId 清单个用户价 */
export function invalidatePriceCache(userId?: number) {
  if (userId === undefined) {
    priceCache = null; modelCache = null; priceCacheAt = 0
    catalogExact = null; catalogByModel = null; catalogCacheAt = 0
  } else userCache.delete(userId)
}
