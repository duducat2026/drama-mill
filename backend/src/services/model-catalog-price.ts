/**
 * Drama Mill — AI 短剧生成平台
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { db, schema } from '../db/index.js'
import { or, isNull, eq } from 'drizzle-orm'

// ─── 目录价派生刊例：model_catalog_prices → 计费口径价格行（目录价即刊例价，无落库副本） ───

/** 单行原始价格（仅取映射所需列） */
type RawPrice = {
  model_id: string | null
  model_name: string | null
  provider: string | null
  price_name: string | null
  price: string | null
  price_unit: string | null
  currency: string | null
  source: string | null
  source_url: string | null
}

export type CatalogPricePlan = {
  provider: string
  model: string
  billing_type: 'token' | 'image' | 'video_second'
  input_price: number
  output_price: number
  unit_price: number
  currency: string
  source: string | null
}

const round = (n: number) => Math.round(n * 1e6) / 1e6
const isUsd = (r: RawPrice) => r.currency === 'USD' || /\u7f8e\u5143/.test(r.price_unit || '') || /\u7f8e\u5143/.test(r.price_name || '')
const toNum = (v: string | null) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}
const hasUnit = (r: RawPrice, re: RegExp) => re.test(r.price_unit || '')
const batch = (r: RawPrice) => /batch/i.test(r.price_name || '')

/** USD→CNY 折算汇率：目录计价统一口径，可用 CATALOG_USD_CNY_RATE 覆盖 */
export function catalogUsdRate(): number {
  const n = Number(process.env.CATALOG_USD_CNY_RATE)
  return Number.isFinite(n) && n > 0 ? n : 7.2
}

/** 按产品线优先级判定计费类型：视频(每秒) > 图片(每张) > token(输入/输出)；均不命中返回 null */
export function buildPlan(rows: RawPrice[], usdRate: number): CatalogPricePlan | null {
  const first = rows[0]
  const base = {
    provider: first.provider || 'model-list',
    model: first.model_id || first.model_name || '',
    currency: 'CNY',
    source: first.source || first.source_url || 'model_list',
  }
  if (!base.model) return null

  // 1) 视频：单位含“秒”且非 Batch 档；取最低每秒单价（与人工录入口径一致）
  const video = rows.filter(r => hasUnit(r, /\u79d2|\/s/i) && !batch(r))
  if (video.length) {
    const unit = Math.min(...video.map(r => toNum(r.price) * (isUsd(r) ? usdRate : 1)))
    if (unit > 0) return { ...base, billing_type: 'video_second', input_price: 0, output_price: 0, unit_price: round(unit) }
  }

  // 2) 图片：单位含“张”；优先“生成/输出”项，取最低价
  const image = rows.filter(r => hasUnit(r, /\u5f20/))
  if (image.length) {
    const gen = image.filter(r => /\u751f\u6210|\u8f93\u51fa/.test(r.price_name || ''))
    const pick = (gen.length ? gen : image)
    const unit = Math.min(...pick.map(r => toNum(r.price) * (isUsd(r) ? usdRate : 1)))
    if (unit > 0) return { ...base, billing_type: 'image', input_price: 0, output_price: 0, unit_price: round(unit) }
  }

  // 3) token：单位含 token；输入/输出取基础档（排除缓存/思考/Batch/多模态冒号变体）
  //    档名兼容中英文：中文前缀「输入/输出」，英文按 input|prompt / output|completion 词匹配
  const tokenRows = rows.filter(r => hasUnit(r, /token/i))
  if (tokenRows.length) {
    const exclude = /缓存|思考|cached|thinking|reasoning|batch/i
    const isInput = (r: RawPrice) => /输入/.test(r.price_name || '') || /\b(input|prompt)\b/i.test(r.price_name || '')
    const isOutput = (r: RawPrice) => /输出/.test(r.price_name || '') || /\b(output|completion)\b/i.test(r.price_name || '')
    const clean = (test: (r: RawPrice) => boolean) =>
      tokenRows.filter(r => test(r) && !exclude.test(r.price_name || ''))
    const pickLow = (list: RawPrice[]) => list.length ? Math.min(...list.map(r => toNum(r.price) * (isUsd(r) ? usdRate : 1))) : 0
    let input = pickLow(clean(isInput))
    const output = pickLow(clean(isOutput))
    // 裸输入档缺失时（deepseek/kimi 等仅有「输入（缓存命中/未命中）」分档），回退取缓存未命中档
    if (!(input > 0)) input = pickLow(tokenRows.filter(r => isInput(r) && /未命中|cache miss/i.test(r.price_name || '')))
    if (input > 0 || output > 0) return { ...base, billing_type: 'token', input_price: round(input), output_price: round(output), unit_price: 0 }
  }

  return null
}

/**
 * 读取在售目录价格行（0 或 NULL 视为在售）。
 */
async function loadOnSaleRows(): Promise<RawPrice[]> {
  const P = schema.modelCatalogPrices
  return (await db.select({
    modelId: P.modelId,
    modelName: P.modelName,
    provider: P.provider,
    priceName: P.priceName,
    price: P.price,
    priceUnit: P.priceUnit,
    currency: P.currency,
    source: P.source,
    sourceUrl: P.sourceUrl,
    isOffline: P.isOffline,
  }).from(P).where(or(eq(P.isOffline, false), isNull(P.isOffline)))
    .orderBy(P.modelId, P.id)
  ).map(r => ({
    model_id: r.modelId, model_name: r.modelName, provider: r.provider, price_name: r.priceName,
    price: r.price, price_unit: r.priceUnit, currency: r.currency, source: r.source, source_url: r.sourceUrl,
  }))
}

/**
 * 从主库目录表聚合派生全量刊例价计划（目录价即刊例价）：
 * - 按 model_id 聚合，仅保留含 token/图片/视频可计费档的模型（纯语音/按字符/按次跳过）；
 * - 同名重复首条为准；USD 按 catalogUsdRate 折算 CNY。
 * 调用方自带缓存（cost-price-lookup 60s / 用户目录端点即时调用）。
 */
export async function deriveCatalogPlans(): Promise<CatalogPricePlan[]> {
  const usdRate = catalogUsdRate()
  const groups = new Map<string, RawPrice[]>()
  for (const r of await loadOnSaleRows()) {
    const key = r.model_id || r.model_name || ''
    if (!key) continue
    const arr = groups.get(key)
    if (arr) arr.push(r)
    else groups.set(key, [r])
  }
  const plans: CatalogPricePlan[] = []
  const seen = new Set<string>()
  for (const [, grp] of groups) {
    const plan = buildPlan(grp, usdRate)
    if (!plan) continue
    if (seen.has(plan.model)) continue
    seen.add(plan.model)
    plans.push(plan)
  }
  return plans
}
