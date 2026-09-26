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
import { eq, and, isNull, or } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, badRequest, notFound, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'

const app = new Hono()

const VALUE_PATTERN = /^[a-z0-9][a-z0-9-]*$/

// 风格预设多租户：user_id NULL = 系统内置（全局共享，仅 admin 可改），否则为用户私有
// 响应附加 is_system 派生字段，前端据此区分展示与权限
function toPresetDto(r: typeof schema.stylePresets.$inferSelect) {
  return { ...toSnakeCase(r), is_system: r.userId === null }
}

/** 行是否可被当前用户修改/删除：自己的私有行；系统内置行仅 admin */
function canModify(row: typeof schema.stylePresets.$inferSelect, user: { id: number; role: string }) {
  if (row.userId === null) return user.role === 'admin'
  return row.userId === user.id
}

// GET /style-presets — 系统内置 + 当前用户私有；默认只返回启用项，?all=1 返回全部
app.get('/', async (c) => {
  const user = c.get('user')
  const all = c.req.query('all') === '1'
  const rows = await db.select().from(schema.stylePresets)
    .where(or(isNull(schema.stylePresets.userId), eq(schema.stylePresets.userId, user.id)))
  const filtered = all ? rows : rows.filter(r => r.isActive)
  filtered.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.id - b.id)
  return success(c, filtered.map(toPresetDto))
})

// POST /style-presets — 新增风格预设（默认当前用户私有；admin 可传 is_system 创建内置）
app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  if (!body.name?.trim()) return badRequest(c, '风格名称必填')
  if (!body.value?.trim()) return badRequest(c, '风格 key 必填')
  if (!VALUE_PATTERN.test(body.value.trim())) return badRequest(c, '风格 key 仅支持小写字母、数字、中划线')
  if (!body.prompt?.trim()) return badRequest(c, '提示词片段必填')

  const isSystem = !!body.is_system && user.role === 'admin'
  const value = body.value.trim()
  // 查重范围：系统内置命名空间 + 当前用户自己的风格，保证下拉选项 value 不歧义
  const [dup] = await db.select().from(schema.stylePresets)
    .where(and(
      eq(schema.stylePresets.value, value),
      isSystem ? isNull(schema.stylePresets.userId) : or(isNull(schema.stylePresets.userId), eq(schema.stylePresets.userId, user.id)),
    ))
  if (dup) return badRequest(c, '风格 key 已存在')

  const ts = now()
  const res = await db.insert(schema.stylePresets).values({
    name: body.name.trim(),
    value,
    prompt: body.prompt.trim(),
    description: body.description || null,
    sortOrder: Number(body.sort_order ?? body.sortOrder ?? 0),
    isActive: body.is_active === false || body.is_active === 0 ? false : true,
    userId: isSystem ? null : user.id,
    createdAt: ts,
    updatedAt: ts,
  })
  const [row] = await db.select().from(schema.stylePresets)
    .where(eq(schema.stylePresets.id, getInsertId(res)))
  return created(c, toPresetDto(row))
})

// PUT /style-presets/:id — 更新（value 创建后不可修改；系统内置行仅 admin，私有行仅属主）
app.put('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [row] = await db.select().from(schema.stylePresets)
    .where(eq(schema.stylePresets.id, id))
  if (!row || !canModify(row, user)) return notFound(c, '风格预设不存在')

  const updates: Record<string, any> = { updatedAt: now() }
  if (body.name !== undefined) updates.name = String(body.name).trim()
  if (body.prompt !== undefined) updates.prompt = String(body.prompt).trim()
  if (body.description !== undefined) updates.description = body.description || null
  if (body.sort_order !== undefined || body.sortOrder !== undefined) {
    updates.sortOrder = Number(body.sort_order ?? body.sortOrder)
  }
  if (body.is_active !== undefined || body.isActive !== undefined) {
    const v = body.is_active ?? body.isActive
    updates.isActive = !(v === false || v === 0)
  }
  await db.update(schema.stylePresets).set(updates)
    .where(eq(schema.stylePresets.id, id))
  return success(c)
})

// DELETE /style-presets/:id — 硬删除（系统内置行仅 admin，私有行仅属主；已用项目保留 key，无害）
app.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.stylePresets)
    .where(eq(schema.stylePresets.id, id))
  if (!row || !canModify(row, user)) return notFound(c, '风格预设不存在')
  await db.delete(schema.stylePresets).where(eq(schema.stylePresets.id, id))
  return success(c)
})

export default app
