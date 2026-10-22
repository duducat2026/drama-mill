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

import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { badRequest, notFound, now, success } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { invalidatePriceCache } from '../services/cost-price-lookup.js'
import { deriveCatalogPlans } from '../services/model-catalog.js'

const app = new Hono()

// ─── 用户级模型价（从平台基准价导入 / 自定义改价，计价时优先于 model_prices） ───

const BILLING_TYPES = ['token', 'image', 'video_second']

function num(v: unknown) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

// GET /model-prices — 我的价格列表（keyword / billing_type 过滤，量小不分页）
app.get('/', async (c) => {
  const user = c.get('user')
  const keyword = (c.req.query('keyword') || '').trim()
  const billingType = c.req.query('billing_type')
  let rows = await db.select().from(schema.userModelPrices).where(eq(schema.userModelPrices.userId, user.id))
  if (billingType) rows = rows.filter(r => r.billingType === billingType)
  if (keyword) {
    const kw = keyword.toLowerCase()
    rows = rows.filter(r => r.model.toLowerCase().includes(kw) || r.provider.toLowerCase().includes(kw))
  }
  rows.sort((a, b) => `${a.billingType}|${a.model}`.localeCompare(`${b.billingType}|${b.model}`))
  return success(c, rows.map(r => toSnakeCase(r)))
})

// GET /model-prices/catalog?billing_type=&keyword=&page=&page_size= — 平台目录价（附我的导入状态）
// 目录价即刊例价：条目从主库 model_catalog_* 实时聚合派生，不再依赖单独维护的表
app.get('/catalog', async (c) => {
  const user = c.get('user')
  const billingType = c.req.query('billing_type')
  const keyword = (c.req.query('keyword') || '').trim().toLowerCase()
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('page_size')) || 20))

  let plans = await deriveCatalogPlans()
  if (billingType && BILLING_TYPES.includes(billingType)) plans = plans.filter(p => p.billing_type === billingType)
  if (keyword) plans = plans.filter(p => p.model.toLowerCase().includes(keyword) || p.provider.toLowerCase().includes(keyword))
  plans.sort((a, b) => `${a.billing_type}|${a.model}`.localeCompare(`${b.billing_type}|${b.model}`))
  const rows = plans.slice((page - 1) * pageSize, page * pageSize)

  // 我已有价的模型名（含手动新增），用于前端标注「已导入」
  const mine = await db.select({ model: schema.userModelPrices.model })
    .from(schema.userModelPrices).where(eq(schema.userModelPrices.userId, user.id))
  const importedSet = new Set(mine.map(m => m.model))

  return success(c, {
    items: rows.map(p => ({ ...p, imported: importedSet.has(p.model) })),
    total: plans.length,
    page,
    page_size: pageSize,
  })
})

// POST /model-prices/import — 从平台目录价批量拷贝（已存在跳过，不覆盖已有价）
app.post('/import', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => null)
  const items = Array.isArray(body?.items) ? body.items : []
  if (!items.length) return badRequest(c, 'items 不能为空')
  if (items.length > 200) return badRequest(c, '单次最多导入 200 个模型')

  const mine = await db.select({ model: schema.userModelPrices.model })
    .from(schema.userModelPrices).where(eq(schema.userModelPrices.userId, user.id))
  const mineSet = new Set(mine.map(m => m.model))

  const planByModel = new Map((await deriveCatalogPlans()).map(p => [p.model, p]))

  let inserted = 0
  let skipped_existing = 0
  let skipped_missing = 0
  const ts = now()
  for (const it of items) {
    const model = String(it?.model || '').trim()
    if (!model || mineSet.has(model)) { skipped_existing += model ? 1 : 0; if (!model) skipped_missing++; continue }
    const base = planByModel.get(model)
    if (!base) { skipped_missing++; continue }
    await db.insert(schema.userModelPrices).values({
      userId: user.id,
      provider: base.provider,
      model: base.model,
      billingType: base.billing_type,
      inputPrice: base.input_price,
      outputPrice: base.output_price,
      unitPrice: base.unit_price,
      currency: base.currency || 'CNY',
      source: 'platform',
      updatedAt: ts,
    })
    mineSet.add(model)
    inserted++
  }
  invalidatePriceCache(user.id)
  return success(c, { inserted, skipped_existing, skipped_missing })
})

// POST /model-prices — 手工新增自定义价
app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const provider = String(body.provider || '').trim()
  const model = String(body.model || '').trim()
  const billingType = String(body.billing_type || '').trim()
  if (!model) return badRequest(c, 'model 必填')
  if (!provider) return badRequest(c, 'provider 必填')
  if (!BILLING_TYPES.includes(billingType)) return badRequest(c, 'billing_type 必须为 token / image / video_second')
  const [exist] = await db.select().from(schema.userModelPrices)
    .where(and(eq(schema.userModelPrices.userId, user.id), eq(schema.userModelPrices.model, model)))
  if (exist) return badRequest(c, '该模型已在你的价格表中，请直接改价')
  const res = await db.insert(schema.userModelPrices).values({
    userId: user.id,
    provider,
    model,
    billingType,
    inputPrice: num(body.input_price),
    outputPrice: num(body.output_price),
    unitPrice: num(body.unit_price),
    currency: body.currency || 'CNY',
    source: 'manual',
    updatedAt: now(),
  })
  invalidatePriceCache(user.id)
  const [row] = await db.select().from(schema.userModelPrices).where(eq(schema.userModelPrices.id, getInsertId(res)))
  return success(c, toSnakeCase(row))
})

// PUT /model-prices/:id — 改价（仅本人行；改价即视为自定义，source 置 manual）
app.put('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.userModelPrices)
    .where(and(eq(schema.userModelPrices.id, id), eq(schema.userModelPrices.userId, user.id)))
  if (!row) return notFound(c, '价格记录不存在')
  const body = await c.req.json().catch(() => ({}))
  const fields: Record<string, unknown> = { updatedAt: now(), source: 'manual' }
  if (body.input_price !== undefined) fields.inputPrice = num(body.input_price)
  if (body.output_price !== undefined) fields.outputPrice = num(body.output_price)
  if (body.unit_price !== undefined) fields.unitPrice = num(body.unit_price)
  if (body.currency !== undefined) fields.currency = String(body.currency)
  if (body.billing_type !== undefined && BILLING_TYPES.includes(String(body.billing_type))) fields.billingType = String(body.billing_type)
  await db.update(schema.userModelPrices).set(fields).where(eq(schema.userModelPrices.id, id))
  invalidatePriceCache(user.id)
  const [updated] = await db.select().from(schema.userModelPrices).where(eq(schema.userModelPrices.id, id))
  return success(c, toSnakeCase(updated))
})

// DELETE /model-prices/:id — 删除本人行，该模型回退平台基准计价
app.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.userModelPrices)
    .where(and(eq(schema.userModelPrices.id, id), eq(schema.userModelPrices.userId, user.id)))
  if (!row) return notFound(c, '价格记录不存在')
  await db.delete(schema.userModelPrices).where(eq(schema.userModelPrices.id, id))
  invalidatePriceCache(user.id)
  return success(c, { deleted: true })
})

export default app
