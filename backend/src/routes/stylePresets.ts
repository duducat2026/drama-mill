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
 * 风格预设 CRUD：user_id 为 NULL 的行是系统内置（全局共享、仅 admin 可改），
 * 其余为用户私有；响应统一附加 is_system 派生位供前端区分权限展示
 */
import { Hono } from 'hono'
import { eq, and, isNull, or } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, badRequest, notFound, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'

const app = new Hono()

const VALUE_PATTERN = /^[a-z0-9][a-z0-9-]*$/

const isSystemRow = (row: { userId: number | null }) => row.userId === null

function toPresetDto(r: typeof schema.stylePresets.$inferSelect) {
  return { ...toSnakeCase(r), is_system: r.userId === null }
}

/** 修改/删除权限：私有行只认属主；系统内置行只认 admin */
function canModify(row: typeof schema.stylePresets.$inferSelect, user: { id: number; role: string }) {
  if (isSystemRow(row)) return user.role === 'admin'
  return row.userId === user.id
}

// GET /style-presets — 内置 + 自有；默认过滤停用项，?all=1 全量返回
app.get('/', async (c) => {
  const user = c.get('user')
  const all = c.req.query('all') === '1'
  const rows = await db.select().from(schema.stylePresets)
    .where(or(isNull(schema.stylePresets.userId), eq(schema.stylePresets.userId, user.id)))
  const visible = all ? rows : rows.filter(r => r.isActive)
  // 排序稳定：sort_order 小的在前，同值按 id 兜底
  visible.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.id - b.id)
  return success(c, visible.map(toPresetDto))
})

// POST /style-presets — 建档默认私有；admin 传 is_system 才落全局内置
app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  if (!body.name?.trim()) return badRequest(c, '风格名称必填')
  if (!body.value?.trim()) return badRequest(c, '风格 key 必填')
  if (!VALUE_PATTERN.test(body.value.trim())) return badRequest(c, '风格 key 仅支持小写字母、数字、中划线')
  if (!body.prompt?.trim()) return badRequest(c, '提示词片段必填')

  const isSystem = !!body.is_system && user.role === 'admin'
  const value = body.value.trim()
  // 查重视野 = 内置命名空间 + 自己的私有行，保证下拉里同 value 不歧义
  const [dup] = await db.select().from(schema.stylePresets)
    .where(and(
      eq(schema.stylePresets.value, value),
      isSystem ? isNull(schema.stylePresets.userId) : or(isNull(schema.stylePresets.userId), eq(schema.stylePresets.userId, user.id)),
    ))
  if (dup) return badRequest(c, '风格 key 已存在')

  const ts = now()
  const res = await db.insert(schema.stylePresets).values({
    userId: isSystem ? null : user.id,
    isActive: body.is_active === false || body.is_active === 0 ? false : true,
    sortOrder: Number(body.sort_order ?? body.sortOrder ?? 0),
    description: body.description || null,
    prompt: body.prompt.trim(),
    value,
    name: body.name.trim(),
    createdAt: ts,
    updatedAt: ts,
  })
  const [row] = await db.select().from(schema.stylePresets)
    .where(eq(schema.stylePresets.id, getInsertId(res)))
  return created(c, toPresetDto(row))
})

// PUT /style-presets/:id — value 建档后锁定不可改；越权改按不存在处理
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

// DELETE /style-presets/:id — 物理删行；内置行只有 admin 能删
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
