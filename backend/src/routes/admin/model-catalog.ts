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
import { CatalogUnavailable, catalogStats, importCatalogPrices, listCatalogModels, listCatalogPrices, pricesOfModel } from '../../services/model-catalog.js'
import { badRequest, success } from '../../utils/response.js'
import { pageOf } from './shared.js'

const app = new Hono()

// ─── 11b. 模型目录价（平台侧：从独立 model_list 库只读提取模型清单与价格列表） ───

/** 目录价分页参数：复用通用 pageOf，page_size 上限放宽到 100（目录清单字段多） */
function catalogPageOf(c: any): { page: number; pageSize: number } {
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('page_size')) || 20))
  return { page, pageSize }
}

/** 目录库不可达统一处理：转 503 提示，其它异常透传给全局 errorHandler */
function catalogError(c: any, err: any) {
  if (err instanceof CatalogUnavailable) {
    return c.json({ code: 503, message: err.message }, 503)
  }
  throw err
}

// GET /admin/model-catalog/stats — 页头概览 + 厂商/来源下拉数据
app.get('/model-catalog/stats', async (c) => {
  try {
    return success(c, await catalogStats())
  } catch (err) {
    return catalogError(c, err)
  }
})

// GET /admin/model-catalog/models?keyword=&provider=&source=&offline=&page= — 模型清单
app.get('/model-catalog/models', async (c) => {
  const { page, pageSize } = catalogPageOf(c)
  try {
    const data = await listCatalogModels({
      keyword: (c.req.query('keyword') || '').trim(),
      provider: (c.req.query('provider') || '').trim(),
      source: (c.req.query('source') || '').trim(),
      offline: c.req.query('offline') || '',
      page,
      pageSize,
    })
    return success(c, data)
  } catch (err) {
    return catalogError(c, err)
  }
})

// GET /admin/model-catalog/prices?keyword=&model_id=&provider=&source=&offline=&page= — 模型价格列表
app.get('/model-catalog/prices', async (c) => {
  const { page, pageSize } = catalogPageOf(c)
  try {
    const data = await listCatalogPrices({
      keyword: (c.req.query('keyword') || '').trim(),
      modelId: (c.req.query('model_id') || '').trim(),
      provider: (c.req.query('provider') || '').trim(),
      source: (c.req.query('source') || '').trim(),
      offline: c.req.query('offline') || '',
      page,
      pageSize,
    })
    return success(c, data)
  } catch (err) {
    return catalogError(c, err)
  }
})

// GET /admin/model-catalog/prices-of?model_id= — 单模型全部价格明细（模型清单行内展开）
app.get('/model-catalog/prices-of', async (c) => {
  const modelId = (c.req.query('model_id') || '').trim()
  if (!modelId) return badRequest(c, 'model_id 必填')
  try {
    return success(c, await pricesOfModel(modelId))
  } catch (err) {
    return catalogError(c, err)
  }
})

// POST /admin/model-catalog/import — 将目录价导入平台刊例价（仅含价格模型 / 只补空缺 / USD 折算）
// body: { usd_rate?: number, dry_run?: boolean }；dry_run 仅返回导入预览
app.post('/model-catalog/import', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const rawRate = Number(body.usd_rate)
  const usdRate = Number.isFinite(rawRate) && rawRate > 0 ? rawRate : undefined
  try {
    return success(c, await importCatalogPrices({ usdRate, dryRun: body.dry_run === true || body.dry_run === 1 }))
  } catch (err) {
    return catalogError(c, err)
  }
})


export default app
