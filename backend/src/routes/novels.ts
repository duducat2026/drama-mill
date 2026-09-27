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
 * 小说管理路由 — 上传入库（可直入小说库不建项目）+ 列表/修改/删除/预览 + 拆分任务控制 + 批量建项目
 */
import { Hono } from 'hono'
import { eq, and, inArray, isNull, like, desc, asc, sql } from 'drizzle-orm'
import mammoth from 'mammoth'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, badRequest, notFound, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { countChars, detectChapters } from '../services/novel-split.js'
import { getDramaOwned, getNovelOwned } from '../services/ownership.js'
import novelsProduction from './novels-production.js'

const app = new Hono()
app.route('/', novelsProduction)

export const NOVEL_EXT = new Set(['.txt', '.md', '.docx'])
export const NOVEL_MAX = 10 * 1024 * 1024 // 10MB

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

/** 编码自动识别：严格 UTF-8 解码失败则回退 GB18030（中文电子书常见编码） */
export function decodeNovelBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('gb18030').decode(bytes)
  }
}

// 去 BOM + 统一换行为 \n + 压缩连续空行（导出供批量上传复用）
export function normalizeText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 按扩展名提取小说纯文本：.docx 走 mammoth，其余按编码自动识别（供单部/批量上传复用） */
export async function extractNovelText(fileName: string, buffer: ArrayBuffer): Promise<string> {
  if (extOf(fileName) === '.docx') {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) })
    return normalizeText(result.value || '')
  }
  return normalizeText(decodeNovelBuffer(buffer))
}

// POST /novels/upload — multipart：file + drama_id?（不传则入小说库，不建项目） + title?
app.post('/upload', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) return badRequest(c, 'file is required')
  const dramaId = Number(body['drama_id']) || null
  if (dramaId) await getDramaOwned(dramaId, user)

  if (!NOVEL_EXT.has(extOf(file.name))) return badRequest(c, '仅支持 .txt / .md / .docx 格式的小说文件')
  const buffer = await file.arrayBuffer()
  if (buffer.byteLength > NOVEL_MAX) return badRequest(c, '小说文件大小不能超过 10MB')

  const content = await extractNovelText(file.name, buffer)
  if (!content) return badRequest(c, '文件内容为空')

  const title = String(body['title'] || '').trim() || file.name.replace(/\.[^.]+$/, '')
  const charCount = countChars(content)
  const chapterCount = detectChapters(content).length
  const ts = now()
  const res = await db.insert(schema.novels).values({
    dramaId,
    title,
    fileName: file.name,
    content,
    charCount,
    chapterCount,
    splitStatus: 'uploaded',
    userId: user.id,
    createdAt: ts,
    updatedAt: ts,
  })
  const novelId = getInsertId(res)
  const [row] = await db.select(NOVEL_SLIM_COLUMNS).from(schema.novels).where(eq(schema.novels.id, novelId))
  return created(c, toSnakeCase(row))
})

/** 列表投影列：不含正文（content 为 MEDIUMTEXT，列表场景禁止携带） */
const NOVEL_SLIM_COLUMNS = {
  id: schema.novels.id,
  dramaId: schema.novels.dramaId,
  title: schema.novels.title,
  fileName: schema.novels.fileName,
  charCount: schema.novels.charCount,
  chapterCount: schema.novels.chapterCount,
  splitStatus: schema.novels.splitStatus,
  splitError: schema.novels.splitError,
  splitInfo: schema.novels.splitInfo,
  splitTemplateId: schema.novels.splitTemplateId,
  createdAt: schema.novels.createdAt,
  updatedAt: schema.novels.updatedAt,
}

// GET /novels — 带 drama_id 查某剧小说；不带则返回当前用户的小说库列表（真实分页，附所属项目信息）
app.get('/', async (c) => {
  const user = c.get('user')
  const dramaId = Number(c.req.query('drama_id'))
  if (dramaId) {
    await getDramaOwned(dramaId, user)
    const rows = await db.select(NOVEL_SLIM_COLUMNS).from(schema.novels)
      .where(and(eq(schema.novels.dramaId, dramaId), isNull(schema.novels.deletedAt)))
    return success(c, rows.map(r => toSnakeCase(r)))
  }
  // 小说库列表：过滤条件全部下推 SQL（COUNT + LIMIT/OFFSET），不全量加载
  const page = Math.max(1, Number(c.req.query('page') || 1))
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('page_size') || 20)))
  const keyword = (c.req.query('keyword') || '').trim()
  const conds: any[] = [eq(schema.novels.userId, user.id), isNull(schema.novels.deletedAt)]
  if (keyword) conds.push(like(schema.novels.title, `%${keyword}%`))
  const where = and(...conds)

  const [{ value: total }] = await db.select({ value: sql<number>`COUNT(*)` }).from(schema.novels).where(where)
  const rows = Number(total)
    ? await db.select(NOVEL_SLIM_COLUMNS).from(schema.novels).where(where)
        .orderBy(desc(schema.novels.createdAt), asc(schema.novels.id))
        .limit(pageSize).offset((page - 1) * pageSize)
    : []

  // 附所属项目标题/状态（页内批量点查）
  const dramaIds = [...new Set(rows.map(r => r.dramaId).filter((v): v is number => !!v))]
  const dramaRows = dramaIds.length
    ? await db.select({ id: schema.dramas.id, title: schema.dramas.title, status: schema.dramas.status, deletedAt: schema.dramas.deletedAt }).from(schema.dramas).where(inArray(schema.dramas.id, dramaIds))
    : []
  const dramaMap = new Map(dramaRows.filter(d => !d.deletedAt).map(d => [d.id, d]))
  return success(c, {
    items: rows.map((r) => {
      const drama = r.dramaId ? dramaMap.get(r.dramaId) : undefined
      return {
        ...toSnakeCase(r),
        drama_title: drama?.title ?? null,
        drama_status: drama?.status ?? null,
      }
    }),
    pagination: { page, page_size: pageSize, total: Number(total), total_pages: Math.ceil(Number(total) / pageSize) },
  })
})

// GET /novels/:id/content — 在线预览正文（归属校验；仅返回正文与元信息）
app.get('/:id/content', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const novel = await getNovelOwned(id, user)
  return success(c, {
    id: novel.id,
    title: novel.title,
    content: novel.content,
    char_count: novel.charCount,
    chapter_count: novel.chapterCount,
    split_status: novel.splitStatus,
    created_at: novel.createdAt,
    updated_at: novel.updatedAt,
  })
})

// GET /novels/:id/dramas — 小说生成的项目列表（当前模型：一部小说对应一个项目）
app.get('/:id/dramas', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const novel = await getNovelOwned(id, user)
  if (!novel.dramaId) return success(c, [])
  const [drama] = await db.select({
    id: schema.dramas.id,
    title: schema.dramas.title,
    status: schema.dramas.status,
    style: schema.dramas.style,
    aspectRatio: schema.dramas.aspectRatio,
    createdAt: schema.dramas.createdAt,
    updatedAt: schema.dramas.updatedAt,
    deletedAt: schema.dramas.deletedAt,
  }).from(schema.dramas).where(eq(schema.dramas.id, novel.dramaId))
  if (!drama || drama.deletedAt) return success(c, [])
  // 集数统计（软删过滤）
  const eps = await db.select({ id: schema.episodes.id, deletedAt: schema.episodes.deletedAt }).from(schema.episodes)
    .where(eq(schema.episodes.dramaId, novel.dramaId))
  return success(c, [{ ...toSnakeCase(drama), episode_count: eps.filter(e => !e.deletedAt).length }])
})

// PUT /novels/:id — 修改标题/正文（正文变更时重算字数与章节数；已拆分的小说修改正文需重新拆分）
app.put('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const novel = await getNovelOwned(id, user)
  const body = await c.req.json().catch(() => ({}))
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.title !== undefined) {
    const title = String(body.title).trim()
    if (!title) return badRequest(c, '小说标题不能为空')
    updates.title = title
  }
  if (body.content !== undefined) {
    const content = normalizeText(String(body.content))
    if (!content) return badRequest(c, '小说正文不能为空')
    updates.content = content
    updates.charCount = countChars(content)
    updates.chapterCount = detectChapters(content).length
    // 正文变更后旧拆分结果失效，重置为待拆分（已建剧集保留，需重新拆分追加）
    updates.splitStatus = 'uploaded'
    updates.splitError = null
    updates.splitInfo = null
  }
  await db.update(schema.novels).set(updates).where(eq(schema.novels.id, id))
  const [row] = await db.select(NOVEL_SLIM_COLUMNS).from(schema.novels).where(eq(schema.novels.id, id))
  return success(c, toSnakeCase(row))
})

// DELETE /novels/:id — 软删除（已生成的项目不受影响，保留可追溯）
app.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getNovelOwned(id, user)
  await db.update(schema.novels).set({ deletedAt: now(), updatedAt: now() }).where(eq(schema.novels.id, id))
  return success(c, { id })
})

// POST /novels/batch-delete — 批量软删除（仅限本人小说）
app.post('/batch-delete', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const ids: number[] = Array.isArray(body.ids) ? body.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : []
  if (!ids.length) return badRequest(c, 'ids is required')
  if (ids.length > 500) return badRequest(c, '单次最多删除 500 部小说')
  const rows = await db.select({ id: schema.novels.id, userId: schema.novels.userId }).from(schema.novels)
    .where(and(inArray(schema.novels.id, ids), isNull(schema.novels.deletedAt)))
  const ownedIds = rows.filter(r => r.userId === user.id).map(r => r.id)
  if (!ownedIds.length) return badRequest(c, '没有可删除的小说')
  await db.update(schema.novels).set({ deletedAt: now(), updatedAt: now() }).where(inArray(schema.novels.id, ownedIds))
  return success(c, { deleted: ownedIds.length })
})

export default app
