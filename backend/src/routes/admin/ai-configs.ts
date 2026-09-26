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

import { Hono } from 'hono'
import { db, schema } from '../../db/index.js'
import { maskApiKey } from '../../services/cloud-tasks.js'
import { success } from '../../utils/response.js'
import { toSnakeCase } from '../../utils/transform.js'
import { pageOf, paged, userMap } from './shared.js'

const app = new Hono()

// ─── 3. AI 网关管理 ───

// GET /admin/ai-configs?user_id=&service_type=&keyword= — api_key 一律掩码
app.get('/ai-configs', async (c) => {
  const { page, pageSize } = pageOf(c)
  const userId = Number(c.req.query('user_id')) || undefined
  const serviceType = c.req.query('service_type')
  const keyword = (c.req.query('keyword') || '').trim().toLowerCase()
  let rows = await db.select().from(schema.aiServiceConfigs)
  if (userId) rows = rows.filter(r => r.userId === userId)
  if (serviceType) rows = rows.filter(r => r.serviceType === serviceType)
  if (keyword) rows = rows.filter(r =>
    (r.name || '').toLowerCase().includes(keyword) ||
    (r.provider || '').toLowerCase().includes(keyword) ||
    (r.model || '').toLowerCase().includes(keyword) ||
    (r.baseUrl || '').toLowerCase().includes(keyword))
  rows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  const users = await userMap()
  const result = paged(rows, page, pageSize)
  return success(c, {
    ...result,
    items: result.items.map(r => ({
      ...toSnakeCase(r),
      api_key: maskApiKey(r.apiKey),
      username: r.userId ? users.get(r.userId)?.username ?? null : null,
    })),
  })
})


export default app
