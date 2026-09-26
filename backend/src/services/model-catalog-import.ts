import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { query, wrapError } from './model-catalog-query.js'

// ─── 导入到平台计费刊例价表 model_prices ───

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

export type ImportOptions = { usdRate?: number; dryRun?: boolean }

export type ImportPlan = {
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

/** 按产品线优先级判定计费类型：视频(每秒) > 图片(每张) > token(输入/输出)；均不命中返回 null */
function buildPlan(rows: RawPrice[], usdRate: number): ImportPlan | null {
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
  const tokenRows = rows.filter(r => hasUnit(r, /token/i))
  if (tokenRows.length) {
    const clean = (kw: string) => tokenRows.filter(r =>
      (r.price_name || '').trim().startsWith(kw) && !/\u7f13\u5b58|\u601d\u8003|batch/i.test(r.price_name || ''))
    const pickLow = (list: RawPrice[]) => list.length ? Math.min(...list.map(r => toNum(r.price) * (isUsd(r) ? usdRate : 1))) : 0
    const input = pickLow(clean('\u8f93\u5165'))
    const output = pickLow(clean('\u8f93\u51fa'))
    if (input > 0 || output > 0) return { ...base, billing_type: 'token', input_price: round(input), output_price: round(output), unit_price: 0 }
  }

  return null
}

/**
 * 从 model_list.prices 聚合映射并导入到平台 model_prices。
 * - 仅处理含价格的模型（按 model_id 聚合）；无 token/图片/视频可计费档的模型（纯语音/按字符/按次）跳过。
 * - onlyMissing：按 model 名去重，已存在（含人工维护）的价格不覆盖。
 * - USD 按 usdRate 折算成 CNY；dryRun 仅返回计划不落库。
 */
export async function importCatalogPrices(opts: ImportOptions = {}) {
  const usdRate = opts.usdRate && opts.usdRate > 0 ? opts.usdRate : 7.2
  let rows: RawPrice[]
  try {
    rows = await query<RawPrice>(
      `SELECT model_id, model_name, provider, price_name, price, price_unit, currency, source, source_url
       FROM prices WHERE (is_offline = 0 OR is_offline IS NULL) ORDER BY model_id ASC, id ASC`)
  } catch (err) {
    throw wrapError(err)
  }

  // 按 model_id 聚合（同模型多价格项归为一组）
  const groups = new Map<string, RawPrice[]>()
  for (const r of rows) {
    const key = r.model_id || r.model_name || ''
    if (!key) continue
    const arr = groups.get(key)
    if (arr) arr.push(r)
    else groups.set(key, [r])
  }

  // 现有 model_prices 模型名集合（onlyMissing 去重键：成本查价按 model 名回退）
  const existing = new Set((await db.select({ model: schema.modelPrices.model }).from(schema.modelPrices)).map(x => x.model))

  const plans: ImportPlan[] = []
  const seen = new Set<string>()
  let skipped_unsupported = 0
  let skipped_existing = 0
  for (const [, grp] of groups) {
    const plan = buildPlan(grp, usdRate)
    if (!plan) { skipped_unsupported++; continue }
    if (seen.has(plan.model)) continue // 目录内同名重复，首条为准
    seen.add(plan.model)
    if (existing.has(plan.model)) { skipped_existing++; continue }
    plans.push(plan)
  }

  const by_type = plans.reduce((acc, p) => { acc[p.billing_type] = (acc[p.billing_type] || 0) + 1; return acc }, {} as Record<string, number>)
  const result = {
    dry_run: !!opts.dryRun,
    usd_rate: usdRate,
    planned: plans.length,
    inserted: 0,
    skipped_existing,
    skipped_unsupported,
    by_type,
    sample: plans.slice(0, 30),
  }
  if (opts.dryRun) return result

  const ts = now()
  for (const p of plans) {
    await db.insert(schema.modelPrices).values({
      provider: p.provider,
      model: p.model,
      billingType: p.billing_type,
      inputPrice: p.input_price,
      outputPrice: p.output_price,
      unitPrice: p.unit_price,
      currency: p.currency,
      source: p.source,
      updatedAt: ts,
    })
    result.inserted++
  }
  return result
}
