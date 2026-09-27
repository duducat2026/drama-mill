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
import { db, getInsertId, schema } from '../../db/index.js'
import { badRequest, notFound, now, success } from '../../utils/response.js'
import { toSnakeCase } from '../../utils/transform.js'
import { eq } from 'drizzle-orm'

const app = new Hono()

// ─── 11. 模型刊例价维护 ───

// GET /admin/model-prices?provider=&keyword=
app.get('/model-prices', async (c) => {
  const provider = c.req.query('provider')
  const keyword = (c.req.query('keyword') || '').trim().toLowerCase()
  let rows = await db.select().from(schema.modelPrices)
  if (provider) rows = rows.filter(r => r.provider === provider)
  if (keyword) rows = rows.filter(r => r.model.toLowerCase().includes(keyword) || r.provider.toLowerCase().includes(keyword))
  rows.sort((a, b) => `${a.provider}|${a.model}`.localeCompare(`${b.provider}|${b.model}`))
  return success(c, rows.map(r => toSnakeCase(r)))
})

// POST /admin/model-prices — 新增模型价格
app.post('/model-prices', async (c) => {
  const body = await c.req.json()
  const provider = String(body.provider || '').trim()
  const model = String(body.model || '').trim()
  const billingType = String(body.billing_type || '').trim()
  if (!provider || !model) return badRequest(c, 'provider 与 model 必填')
  if (!['token', 'image', 'video_second'].includes(billingType)) return badRequest(c, 'billing_type 必须为 token / image / video_second')
  const [exist] = await db.select().from(schema.modelPrices).where(eq(schema.modelPrices.model, model))
  if (exist && exist.provider === provider) return badRequest(c, '该 provider + model 已存在，请用 PUT 更新')
  const res = await db.insert(schema.modelPrices).values({
    provider,
    model,
    billingType,
    inputPrice: Number(body.input_price) || 0,
    outputPrice: Number(body.output_price) || 0,
    unitPrice: Number(body.unit_price) || 0,
    currency: body.currency || 'CNY',
    source: body.source || 'manual',
    updatedAt: now(),
  })
  const id = getInsertId(res)
  const [row] = await db.select().from(schema.modelPrices).where(eq(schema.modelPrices.id, id))
  return success(c, toSnakeCase(row))
})

// PUT /admin/model-prices/:id — 修正刊例价
app.put('/model-prices/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.modelPrices).where(eq(schema.modelPrices.id, id))
  if (!row) return notFound(c, '价格记录不存在')
  const body = await c.req.json()
  const fields: Record<string, unknown> = { updatedAt: now() }
  if (body.input_price !== undefined) fields.inputPrice = Number(body.input_price) || 0
  if (body.output_price !== undefined) fields.outputPrice = Number(body.output_price) || 0
  if (body.unit_price !== undefined) fields.unitPrice = Number(body.unit_price) || 0
  if (body.billing_type !== undefined) fields.billingType = String(body.billing_type)
  if (body.source !== undefined) fields.source = String(body.source)
  if (body.currency !== undefined) fields.currency = String(body.currency)
  await db.update(schema.modelPrices).set(fields).where(eq(schema.modelPrices.id, id))
  const [updated] = await db.select().from(schema.modelPrices).where(eq(schema.modelPrices.id, id))
  return success(c, toSnakeCase(updated))
})


export default app
