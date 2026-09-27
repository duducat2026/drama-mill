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
import { hashPassword } from '../../services/auth.js'
import { getUserUsageBytes, quotaOf } from '../../services/storage-quota.js'
import { badRequest, notFound, now, success } from '../../utils/response.js'
import { toSnakeCase } from '../../utils/transform.js'
import { eq } from 'drizzle-orm'
import { pageOf, paged } from './shared.js'

const app = new Hono()

// ─── 1. 用户管理 ───

// GET /admin/users?keyword=&status=&page=
app.get('/users', async (c) => {
  const { page, pageSize } = pageOf(c)
  const keyword = (c.req.query('keyword') || '').trim().toLowerCase()
  const status = c.req.query('status')
  let rows = await db.select().from(schema.users)
  if (keyword) rows = rows.filter(u => u.username.toLowerCase().includes(keyword) || (u.nickname || '').toLowerCase().includes(keyword))
  if (status) rows = rows.filter(u => u.status === status)
  rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  // 存储用量/配额（用量走 60s TTL 缓存，与存储监控/运行监控共享探测结果）
  const withUsage = await Promise.all(rows.map(async u => ({
    ...toSnakeCase({ ...u, passwordHash: undefined }),
    storage_usage_bytes: await getUserUsageBytes(u.id),
    storage_quota_bytes: quotaOf(u.storageQuotaBytes),
    storage_quota_custom: u.storageQuotaBytes != null && u.storageQuotaBytes > 0,
  })))
  for (const r of withUsage as any[]) r.storage_exceeded = r.storage_usage_bytes > r.storage_quota_bytes
  return success(c, paged(withUsage, page, pageSize))
})

// POST /admin/users — 新增账号（用户名唯一）
app.post('/users', async (c) => {
  const body = await c.req.json()
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  if (!username || !password) return badRequest(c, 'username 与 password 必填')
  if (password.length < 4) return badRequest(c, '密码至少 4 位')
  const [exist] = await db.select().from(schema.users).where(eq(schema.users.username, username))
  if (exist) return badRequest(c, '用户名已存在')
  const ts = now()
  const res = await db.insert(schema.users).values({
    username,
    passwordHash: hashPassword(password),
    role: body.role === 'admin' ? 'admin' : 'user',
    status: 'active',
    nickname: body.nickname || null,
    createdAt: ts,
    updatedAt: ts,
  })
  const id = getInsertId(res)
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id))
  return success(c, toSnakeCase({ ...row, passwordHash: undefined }))
})

// PUT /admin/users/:id — 启用/禁用、重置密码、调整角色/昵称
app.put('/users/:id', async (c) => {
  const me = c.get('user')
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id))
  if (!row) return notFound(c, '用户不存在')
  const body = await c.req.json()

  const fields: Record<string, unknown> = { updatedAt: now() }
  if (body.status === 'active' || body.status === 'disabled') {
    if (id === me.id) return badRequest(c, '不能修改自己的账号状态')
    fields.status = body.status
  }
  if (body.role === 'admin' || body.role === 'user') {
    if (id === me.id) return badRequest(c, '不能修改自己的角色')
    fields.role = body.role
  }
  if (body.nickname !== undefined) fields.nickname = body.nickname || null
  // 存储配额覆盖（GB）：传 0/空串表示恢复全局默认；非法值忽略
  if (body.storage_quota_gb !== undefined) {
    const gb = Number(body.storage_quota_gb)
    fields.storageQuotaBytes = body.storage_quota_gb === null || body.storage_quota_gb === '' || !Number.isFinite(gb) || gb <= 0
      ? null
      : Math.round(gb * 1024 ** 3)
  }
  if (body.password) {
    if (String(body.password).length < 4) return badRequest(c, '密码至少 4 位')
    fields.passwordHash = hashPassword(String(body.password))
  }

  await db.update(schema.users).set(fields).where(eq(schema.users.id, id))
  const [updated] = await db.select().from(schema.users).where(eq(schema.users.id, id))
  return success(c, toSnakeCase({ ...updated, passwordHash: undefined }))
})


export default app
