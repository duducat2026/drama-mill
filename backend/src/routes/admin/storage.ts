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
import { quotaOf } from '../../services/storage-quota.js'
import { getStorageStats } from '../../services/storage-stats.js'
import { success } from '../../utils/response.js'
import { inArray } from 'drizzle-orm'

const app = new Hono()

// ─── 12. 存储监控（单遍遍历 + 60s 缓存，见 services/storage-stats.ts） ───

// GET /admin/storage-stats — 磁盘用量 + 分类大小/文件数 + 用户空间 TOP50 + 最大文件 TOP10
// ?refresh=1 强制重算（跳过缓存）
app.get('/storage-stats', async (c) => {
  const stats = await getStorageStats(c.req.query('refresh') === '1')
  const storageTotal = stats.storage_total_bytes
  const userIds = stats.per_user.map(u => u.user_id)
  const userRows = userIds.length
    ? await db.select({ id: schema.users.id, username: schema.users.username, nickname: schema.users.nickname, storageQuotaBytes: schema.users.storageQuotaBytes }).from(schema.users).where(inArray(schema.users.id, userIds))
    : []
  const userNames = new Map(userRows.map(u => [u.id, u.nickname || u.username]))
  const userQuotas = new Map(userRows.map(u => [u.id, quotaOf(u.storageQuotaBytes)]))
  const users = stats.per_user.slice(0, 50).map(u => {
    const quota = userQuotas.get(u.user_id) ?? quotaOf(null)
    return {
      ...u,
      username: userNames.get(u.user_id) || (u.user_id === 0 ? '历史未归属（user 0）' : `用户 ${u.user_id}`),
      percent: storageTotal ? +(u.total_bytes / storageTotal * 100).toFixed(1) : 0,
      quota_bytes: u.user_id === 0 ? null : quota,
      exceeded: u.user_id !== 0 && u.total_bytes > quota,
    }
  })

  return success(c, {
    disk: stats.disk,
    storage_root: stats.storage_root,
    storage_total_bytes: storageTotal,
    default_quota_bytes: quotaOf(null),
    categories: stats.categories.map(r => ({ ...r, percent: storageTotal ? +(r.bytes / storageTotal * 100).toFixed(1) : 0 })),
    users,
    top_files: stats.top_files,
    generated_at: stats.generated_at,
  })
})


export default app
