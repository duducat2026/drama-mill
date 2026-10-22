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
import { CatalogUnavailable, batchDeleteCatalogPrices, catalogStats, listCatalogPrices } from '../../services/model-catalog.js'
import { badRequest, success } from '../../utils/response.js'

const app = new Hono()

// ─── 11b. 模型目录价（平台侧：主库 model_catalog_* 表，目录数据由部署期迁移脚本收编自主库） ───

/** 目录价分页参数：独立于通用 pageOf，page_size 上限放宽到 100（价格列表字段多） */
function catalogPageOf(c: any): { page: number; pageSize: number } {
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('page_size')) || 20))
  return { page, pageSize }
}

/** 目录未初始化统一处理：转 503 提示运行迁移脚本，其它异常透传给全局 errorHandler */
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

// POST /admin/model-catalog/batch-delete — 批量删除目录价格条目（目录价即刊例价，删除即退出计价）
// body: { ids: number[] }；单次上限 1000 条
app.post('/model-catalog/batch-delete', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const ids: number[] = [...new Set<number>((Array.isArray(body?.ids) ? body.ids : [])
    .map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0))]
  if (!ids.length) return badRequest(c, 'ids 必须为正整数数组')
  if (ids.length > 1000) return badRequest(c, '单次最多删除 1000 条')
  try {
    return success(c, await batchDeleteCatalogPrices(ids))
  } catch (err) {
    return catalogError(c, err)
  }
})


export default app
