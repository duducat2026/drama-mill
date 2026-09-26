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

/**
 * 小说拆分提示词模版路由 — 多租户模式与风格预设一致：
 * user_id NULL = 系统内置（全局共享，仅 admin 可改），否则为用户私有模版
 */
import { Hono } from 'hono'
import { eq, and, isNull, or } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, badRequest, notFound, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'

const app = new Hono()

const VALUE_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** 拆分方式白名单：chars 按字数归组 / paragraphs 按段落数归组（诗词/笑话推荐） */
function normalizeSplitMode(v: unknown): 'chars' | 'paragraphs' {
  return v === 'paragraphs' ? 'paragraphs' : 'chars'
}

function toDto(r: typeof schema.novelSplitTemplates.$inferSelect) {
  return { ...toSnakeCase(r), is_system: r.userId === null }
}

/** 行是否可被当前用户修改/删除：自己的私有行；系统内置行仅 admin */
function canModify(row: typeof schema.novelSplitTemplates.$inferSelect, user: { id: number; role: string }) {
  if (row.userId === null) return user.role === 'admin'
  return row.userId === user.id
}

/** 校验并取回可用模版：仅系统内置或本人私有且启用；供拆分入口复用 */
export async function getTemplateUsable(templateId: number, user: { id: number; role: string }) {
  const [row] = await db.select().from(schema.novelSplitTemplates)
    .where(eq(schema.novelSplitTemplates.id, templateId))
  if (!row || !row.isActive) return null
  if (row.userId === null || row.userId === user.id) return row
  return null
}

// GET /novel-split-templates — 系统内置 + 当前用户私有；默认只返回启用项，?all=1 返回全部
app.get('/', async (c) => {
  const user = c.get('user')
  const all = c.req.query('all') === '1'
  const rows = await db.select().from(schema.novelSplitTemplates)
    .where(or(isNull(schema.novelSplitTemplates.userId), eq(schema.novelSplitTemplates.userId, user.id)))
  const filtered = all ? rows : rows.filter(r => r.isActive)
  filtered.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.id - b.id)
  return success(c, filtered.map(toDto))
})

// POST /novel-split-templates — 新增模版（默认当前用户私有；admin 可传 is_system 创建系统内置）
app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  if (!body.name?.trim()) return badRequest(c, '模版名称必填')
  if (!body.value?.trim()) return badRequest(c, '模版 key 必填')
  if (!VALUE_PATTERN.test(body.value.trim())) return badRequest(c, '模版 key 仅支持小写字母、数字、中划线')
  if (!body.prompt?.trim()) return badRequest(c, '拆分提示词必填')

  const isSystem = !!body.is_system && user.role === 'admin'
  const value = body.value.trim()
  const splitMode = normalizeSplitMode(body.split_mode)
  // 查重范围：系统内置命名空间 + 当前用户自己的模版，保证下拉选项 value 不歧义
  const [dup] = await db.select().from(schema.novelSplitTemplates)
    .where(and(
      eq(schema.novelSplitTemplates.value, value),
      isSystem ? isNull(schema.novelSplitTemplates.userId) : or(isNull(schema.novelSplitTemplates.userId), eq(schema.novelSplitTemplates.userId, user.id)),
    ))
  if (dup) return badRequest(c, '模版 key 已存在')

  const ts = now()
  const res = await db.insert(schema.novelSplitTemplates).values({
    name: body.name.trim(),
    value,
    prompt: body.prompt.trim(),
    description: body.description || null,
    defaultTargetChars: Number(body.default_target_chars) > 0 ? Number(body.default_target_chars) : null,
    splitMode,
    defaultParagraphs: splitMode === 'paragraphs' && Number(body.default_paragraphs) > 0 ? Math.round(Number(body.default_paragraphs)) : null,
    sortOrder: Number(body.sort_order ?? body.sortOrder ?? 0),
    isActive: body.is_active === false || body.is_active === 0 ? false : true,
    userId: isSystem ? null : user.id,
    createdAt: ts,
    updatedAt: ts,
  })
  const [row] = await db.select().from(schema.novelSplitTemplates)
    .where(eq(schema.novelSplitTemplates.id, getInsertId(res)))
  return created(c, toDto(row))
})

// PUT /novel-split-templates/:id — 更新（value 创建后不可修改；系统内置行仅 admin，私有行仅属主）
app.put('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [row] = await db.select().from(schema.novelSplitTemplates)
    .where(eq(schema.novelSplitTemplates.id, id))
  if (!row || !canModify(row, user)) return notFound(c, '模版不存在')

  const updates: Record<string, any> = { updatedAt: now() }
  if (body.name !== undefined) updates.name = String(body.name).trim()
  if (body.prompt !== undefined) updates.prompt = String(body.prompt).trim()
  if (body.description !== undefined) updates.description = body.description || null
  if (body.default_target_chars !== undefined) {
    const v = Number(body.default_target_chars)
    updates.defaultTargetChars = Number.isFinite(v) && v > 0 ? Math.round(v) : null
  }
  if (body.split_mode !== undefined) {
    updates.splitMode = normalizeSplitMode(body.split_mode)
  }
  if (body.default_paragraphs !== undefined) {
    const v = Number(body.default_paragraphs)
    updates.defaultParagraphs = Number.isFinite(v) && v > 0 ? Math.round(v) : null
  }
  if (body.sort_order !== undefined || body.sortOrder !== undefined) {
    updates.sortOrder = Number(body.sort_order ?? body.sortOrder)
  }
  if (body.is_active !== undefined || body.isActive !== undefined) {
    const v = body.is_active ?? body.isActive
    updates.isActive = !(v === false || v === 0)
  }
  await db.update(schema.novelSplitTemplates).set(updates)
    .where(eq(schema.novelSplitTemplates.id, id))
  const [updated] = await db.select().from(schema.novelSplitTemplates)
    .where(eq(schema.novelSplitTemplates.id, id))
  return success(c, toDto(updated))
})

// DELETE /novel-split-templates/:id — 硬删除（系统内置行仅 admin，私有行仅属主；已拆分小说保留快照不受影响）
app.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.novelSplitTemplates)
    .where(eq(schema.novelSplitTemplates.id, id))
  if (!row || !canModify(row, user)) return notFound(c, '模版不存在')
  await db.delete(schema.novelSplitTemplates).where(eq(schema.novelSplitTemplates.id, id))
  return success(c)
})

export default app
