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
 * AI 成本核算服务 — 每次模型调用落一条 usage_records，按刊例价计价
 * 价格单位：token 类 元/百万Token；image 元/张；video_second 元/秒（均为 CNY）
 * 查价优先级见 cost-price-lookup：用户级模型价 → 平台刊例价
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { lookupPrice, type PriceRow } from './cost-price-lookup.js'

export type { PriceRow }

interface UsageContext {
  userId?: number | null
  dramaId?: number | null
  episodeId?: number | null
  configId?: number | null
  detail?: string
}

/** 文本调用计价：元/百万Token */
function priceTokens(price: PriceRow | undefined, inputTokens: number, outputTokens: number): { cost: number; missing: boolean } {
  if (!price || price.billingType !== 'token') return { cost: 0, missing: true }
  return { cost: (inputTokens * (price.inputPrice || 0) + outputTokens * (price.outputPrice || 0)) / 1_000_000, missing: false }
}

/** 从 AI SDK 生成结果中提取用量（兼容多步：优先累加 steps，其次取顶层 usage） */
export function extractTextUsage(result: any): { inputTokens: number; outputTokens: number } {
  const steps = Array.isArray(result?.steps) ? result.steps : []
  if (steps.length) {
    let inputTokens = 0
    let outputTokens = 0
    let found = false
    for (const step of steps) {
      const u = step?.usage
      if (!u) continue
      found = true
      inputTokens += u.inputTokens ?? u.promptTokens ?? 0
      outputTokens += u.outputTokens ?? u.completionTokens ?? 0
    }
    if (found) return { inputTokens, outputTokens }
  }
  const u = result?.usage
  return {
    inputTokens: u?.inputTokens ?? u?.promptTokens ?? 0,
    outputTokens: u?.outputTokens ?? u?.completionTokens ?? 0,
  }
}

/** 记录一次文本模型调用（失败不阻断主流程） */
export async function recordTextUsage(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  ctx: UsageContext = {},
) {
  try {
    if (!inputTokens && !outputTokens) return
    const price = await lookupPrice(provider, model, ctx.userId)
    const { cost, missing } = priceTokens(price, inputTokens, outputTokens)
    await db.insert(schema.usageRecords).values({
      userId: ctx.userId ?? null,
      dramaId: ctx.dramaId ?? null,
      episodeId: ctx.episodeId ?? null,
      configId: ctx.configId ?? null,
      serviceType: 'text',
      provider,
      model,
      inputTokens,
      outputTokens,
      cost,
      priceMissing: missing,
      detail: ctx.detail || null,
      createdAt: now(),
    })
  } catch (err) {
    console.warn('[cost] 文本用量记录失败:', (err as Error).message)
  }
}

/** 记录一次图片生成（完成时计 1 张） */
export async function recordImageUsage(provider: string, model: string, ctx: UsageContext = {}) {
  try {
    const price = await lookupPrice(provider, model, ctx.userId)
    const missing = !price || price.billingType !== 'image'
    const cost = missing ? 0 : (price!.unitPrice || 0)
    await db.insert(schema.usageRecords).values({
      userId: ctx.userId ?? null,
      dramaId: ctx.dramaId ?? null,
      episodeId: ctx.episodeId ?? null,
      configId: ctx.configId ?? null,
      serviceType: 'image',
      provider,
      model,
      imageCount: 1,
      cost,
      priceMissing: missing,
      detail: ctx.detail || null,
      createdAt: now(),
    })
  } catch (err) {
    console.warn('[cost] 图片用量记录失败:', (err as Error).message)
  }
}

/** 记录一次视频生成（按请求时长秒数计价） */
export async function recordVideoUsage(provider: string, model: string, seconds: number, ctx: UsageContext = {}) {
  try {
    const price = await lookupPrice(provider, model, ctx.userId)
    const missing = !price || price.billingType !== 'video_second'
    const cost = missing ? 0 : (price!.unitPrice || 0) * (seconds || 0)
    await db.insert(schema.usageRecords).values({
      userId: ctx.userId ?? null,
      dramaId: ctx.dramaId ?? null,
      episodeId: ctx.episodeId ?? null,
      configId: ctx.configId ?? null,
      serviceType: 'video',
      provider,
      model,
      videoSeconds: seconds || null,
      cost,
      priceMissing: missing,
      detail: ctx.detail || null,
      createdAt: now(),
    })
  } catch (err) {
    console.warn('[cost] 视频用量记录失败:', (err as Error).message)
  }
}

/**
 * 从 AI SDK 生成结果直接记录文本用量：
 * model 优先取 steps[].request.modelId（覆盖 modelOverride/实际调用模型），其次用传入的配置模型；
 * meta 为 null（无可用配置）时跳过记录
 */
export async function recordTextUsageFromResult(
  result: any,
  meta: { provider: string; model: string } | null | undefined,
  ctx: UsageContext = {},
) {
  if (!meta) return
  const usage = extractTextUsage(result)
  const steps = Array.isArray(result?.steps) ? result.steps : []
  const actualModel = steps.find((s: any) => s?.request?.modelId)?.request?.modelId || meta.model
  await recordTextUsage(meta.provider, actualModel, usage.inputTokens, usage.outputTokens, ctx)
}

/** 聚合成本：按 user/drama/episode 分组汇总 + 明细（汇总下推 SQL 聚合，不将全表载入 Node） */
export async function aggregateCosts(opts: { userId?: number; dramaId?: number; episodeId?: number; limit?: number; dramaIds?: Set<number> | null } = {}) {
  // 过滤条件下推 SQL（利用 idx_usage_records_user_id / drama_id / episode_id 索引）
  const conds = []
  if (opts.userId) conds.push(eq(schema.usageRecords.userId, opts.userId))
  if (opts.dramaId) conds.push(eq(schema.usageRecords.dramaId, opts.dramaId))
  if (opts.episodeId) conds.push(eq(schema.usageRecords.episodeId, opts.episodeId))
  // dramaIds 集合（按项目名检索得到）下推为 IN；空集合直接返回零结果
  if (opts.dramaIds) {
    const ids = [...opts.dramaIds]
    if (!ids.length) return emptyAggregateResult()
    conds.push(inArray(schema.usageRecords.dramaId, ids))
  }
  const where = conds.length ? and(...conds) : undefined

  const U = schema.usageRecords
  const detailCols = {
    id: U.id, userId: U.userId, dramaId: U.dramaId,
    episodeId: U.episodeId, serviceType: U.serviceType,
    provider: U.provider, model: U.model,
    cost: U.cost, priceMissing: U.priceMissing,
    createdAt: U.createdAt,
  }

  const [totals] = await db.select({
    total_cost: sql<number>`COALESCE(SUM(${U.cost}), 0)`,
    total_calls: sql<number>`COUNT(*)`,
    price_missing_calls: sql<number>`COALESCE(SUM(CASE WHEN ${U.priceMissing} THEN 1 ELSE 0 END), 0)`,
  }).from(U).where(where)

  const svcRows = await db.select({
    serviceType: U.serviceType,
    cost: sql<number>`COALESCE(SUM(${U.cost}), 0)`,
  }).from(U).where(where).groupBy(U.serviceType)

  const dramaRows = await db.select({
    drama_id: U.dramaId,
    cost: sql<number>`COALESCE(SUM(${U.cost}), 0)`,
    calls: sql<number>`COUNT(*)`,
    episode_count: sql<number>`COUNT(DISTINCT CASE WHEN ${U.episodeId} IS NOT NULL THEN ${U.episodeId} END)`,
  }).from(U).where(where).groupBy(U.dramaId).orderBy(sql`2 DESC`)

  const episodeRows = await db.select({
    episode_id: U.episodeId,
    drama_id: sql<number | null>`MAX(${U.dramaId})`,
    cost: sql<number>`COALESCE(SUM(${U.cost}), 0)`,
    calls: sql<number>`COUNT(*)`,
  }).from(U).where(where).groupBy(U.episodeId).orderBy(sql`3 DESC`)

  const details = await db.select(detailCols).from(U).where(where)
    .orderBy(desc(U.createdAt)).limit(opts.limit ?? 100)

  return {
    total_cost: round4(Number(totals?.total_cost) || 0),
    total_calls: Number(totals?.total_calls) || 0,
    price_missing_calls: Number(totals?.price_missing_calls) || 0,
    by_service_type: Object.fromEntries(svcRows.map(r => [r.serviceType, round4(Number(r.cost) || 0)])),
    by_drama: dramaRows.filter(r => r.drama_id != null).map(e => ({ drama_id: e.drama_id, cost: round4(Number(e.cost) || 0), calls: Number(e.calls) || 0, episode_count: Number(e.episode_count) || 0 })),
    by_episode: episodeRows.filter(r => r.episode_id != null).map(e => ({ episode_id: e.episode_id, drama_id: e.drama_id, cost: round4(Number(e.cost) || 0), calls: Number(e.calls) || 0 })),
    details,
  }
}

function emptyAggregateResult() {
  return {
    total_cost: 0, total_calls: 0, price_missing_calls: 0,
    by_service_type: {} as Record<string, number>,
    by_drama: [] as any[], by_episode: [] as any[], details: [] as any[],
  }
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000
}
