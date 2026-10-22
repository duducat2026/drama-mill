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
import { and, eq, isNull } from 'drizzle-orm'
import { userMap } from './shared.js'
import { invalidateSplitTemplateCache } from '../novel-split-templates.js'

const app = new Hono()

// ─── 16. 拆分提示词模版管理（平台侧：系统模版创建/修改/检索） ───

const TEMPLATE_VALUE_PATTERN = /^[a-z0-9][a-z0-9-]*$/

function templateDto(r: typeof schema.novelSplitTemplates.$inferSelect) {
  return { ...toSnakeCase(r), is_system: r.userId === null }
}

// GET /admin/novel-split-templates?keyword=&system_only=1 — 检索模版（默认全部含用户私有）
app.get('/novel-split-templates', async (c) => {
  const keyword = (c.req.query('keyword') || '').trim().toLowerCase()
  const systemOnly = c.req.query('system_only') === '1'
  let rows = await db.select().from(schema.novelSplitTemplates)
    .where(systemOnly ? isNull(schema.novelSplitTemplates.userId) : undefined)
  if (keyword) rows = rows.filter(r =>
    r.name.toLowerCase().includes(keyword) ||
    r.value.toLowerCase().includes(keyword) ||
    r.prompt.toLowerCase().includes(keyword))
  rows.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.id - b.id)
  const users = await userMap()
  return success(c, rows.map(r => ({
    ...templateDto(r),
    creator: r.userId ? users.get(r.userId)?.username ?? null : null,
  })))
})

// POST /admin/novel-split-templates — 创建模版（默认系统内置；is_system=0 时归当前管理员私有）
app.post('/novel-split-templates', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  if (!body.name?.trim()) return badRequest(c, '模版名称必填')
  if (!body.value?.trim()) return badRequest(c, '模版 key 必填')
  if (!TEMPLATE_VALUE_PATTERN.test(body.value.trim())) return badRequest(c, '模版 key 仅支持小写字母、数字、中划线')
  if (!body.prompt?.trim()) return badRequest(c, '拆分提示词必填')
  const isSystem = body.is_system !== false && body.is_system !== 0
  const value = body.value.trim()
  // 拆分方式白名单：paragraphs 按段落数归组（诗词/笑话推荐），其余按字数归组
  const splitMode = body.split_mode === 'paragraphs' ? 'paragraphs' : 'chars'
  const [dup] = await db.select().from(schema.novelSplitTemplates)
    .where(and(eq(schema.novelSplitTemplates.value, value), isSystem ? isNull(schema.novelSplitTemplates.userId) : eq(schema.novelSplitTemplates.userId, user.id)))
  if (dup) return badRequest(c, '同名模版 key 已存在')
  const ts = now()
  const res = await db.insert(schema.novelSplitTemplates).values({
    name: body.name.trim(),
    value,
    prompt: body.prompt.trim(),
    description: body.description || null,
    defaultTargetChars: Number(body.default_target_chars) > 0 ? Number(body.default_target_chars) : null,
    splitMode,
    defaultParagraphs: splitMode === 'paragraphs' && Number(body.default_paragraphs) > 0 ? Math.round(Number(body.default_paragraphs)) : null,
    sortOrder: Number(body.sort_order ?? 0),
    isActive: body.is_active === false || body.is_active === 0 ? false : true,
    userId: isSystem ? null : user.id,
    createdAt: ts,
    updatedAt: ts,
  })
  const [row] = await db.select().from(schema.novelSplitTemplates).where(eq(schema.novelSplitTemplates.id, getInsertId(res)))
  invalidateSplitTemplateCache()
  return success(c, templateDto(row))
})

// PUT /admin/novel-split-templates/:id — 修改模版（管理员可改全部，含系统内置）
app.put('/novel-split-templates/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.novelSplitTemplates).where(eq(schema.novelSplitTemplates.id, id))
  if (!row) return notFound(c, '模版不存在')
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.name !== undefined) updates.name = String(body.name).trim()
  if (body.prompt !== undefined) updates.prompt = String(body.prompt).trim()
  if (body.description !== undefined) updates.description = body.description || null
  if (body.default_target_chars !== undefined) {
    const v = Number(body.default_target_chars)
    updates.defaultTargetChars = Number.isFinite(v) && v > 0 ? Math.round(v) : null
  }
  if (body.split_mode !== undefined) {
    updates.splitMode = body.split_mode === 'paragraphs' ? 'paragraphs' : 'chars'
  }
  if (body.default_paragraphs !== undefined) {
    const v = Number(body.default_paragraphs)
    updates.defaultParagraphs = Number.isFinite(v) && v > 0 ? Math.round(v) : null
  }
  if (body.sort_order !== undefined) updates.sortOrder = Number(body.sort_order)
  if (body.is_active !== undefined) updates.isActive = !(body.is_active === false || body.is_active === 0)
  await db.update(schema.novelSplitTemplates).set(updates).where(eq(schema.novelSplitTemplates.id, id))
  const [updated] = await db.select().from(schema.novelSplitTemplates).where(eq(schema.novelSplitTemplates.id, id))
  invalidateSplitTemplateCache()
  return success(c, templateDto(updated))
})

// DELETE /admin/novel-split-templates/:id — 删除模版（已拆分小说的快照不受影响）
app.delete('/novel-split-templates/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.novelSplitTemplates).where(eq(schema.novelSplitTemplates.id, id))
  if (!row) return notFound(c, '模版不存在')
  await db.delete(schema.novelSplitTemplates).where(eq(schema.novelSplitTemplates.id, id))
  invalidateSplitTemplateCache()
  return success(c, { id })
})


export default app
