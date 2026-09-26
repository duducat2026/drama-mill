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
 * 批量生产编排路由 — 一次上传多部小说，按顺序逐部完成分集与视频生产
 */
import { Hono } from 'hono'
import { eq, and, isNull } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, badRequest, notFound, now } from '../utils/response.js'
import { countChars, detectChapters } from '../services/novel-split.js'
import { NOVEL_EXT, NOVEL_MAX, extractNovelText } from './novels.js'
import {
  createBatch, startBatch, pauseBatch, cancelBatch, getBatchDetail, listBatches, isBatchLoopActive, produceBatch,
} from '../services/production-batch.js'
import { getRateConfig } from '../utils/rate-config.js'
import { getTaskQueueStats } from '../services/generation.js'
import { aiCallGuard } from '../services/ai-switch.js'
import { getTemplateUsable } from './novel-split-templates.js'

const app = new Hono()

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

/** 归属校验：批次不存在或非当前用户一律 404 */
async function requireBatch(c: any): Promise<{ id: number; row: any } | null> {
  const batchId = Number(c.req.param('id'))
  const user = c.get('user')
  if (!batchId) return null
  const [row] = await db.select().from(schema.productionBatches)
    .where(and(eq(schema.productionBatches.id, batchId), isNull(schema.productionBatches.deletedAt)))
  if (!row || row.userId !== user.id) return null
  return { id: batchId, row }
}

// GET /production-batch/rate-config — 各环节并发/速率配置与生成队列实况（注意：须先于 /:id 定义）
app.get('/rate-config', async (c) => {
  return success(c, { ...getRateConfig(), generation_queue: getTaskQueueStats() })
})

// POST /production-batch/upload — 多文件上传：每个文件自动建剧 + 入小说，组成批次
// 表单字段: files（可多个）、style、aspect_ratio、target_chars、split_template_id（拆分提示词模版）、
// mode（'split_only' 两步走：先拆分停下待确认再生产；默认 full 拆分后自动生产）、auto_start（'1' 上传后立即启动）
app.post('/upload', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody({ all: true })
  const rawFiles = body['files']
  const rawList: Array<string | File> = Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : []
  const files = rawList.filter((f): f is File => f instanceof File)
  if (!files.length) return badRequest(c, '请至少上传一个小说文件（字段名 files）')
  if (files.length > 20) return badRequest(c, '单批次最多 20 部小说')

  const style = String(body['style'] || '') || undefined
  const aspectRatio = String(body['aspect_ratio'] || '') || '16:9'
  let targetChars = Number(body['target_chars']) || undefined
  // 两步走模式：拆分与创作生产拆成两步（先拆分入库，确认后再启动生产）
  const batchMode: 'full' | 'split_only' = String(body['mode'] || '') === 'split_only' ? 'split_only' : 'full'

  // 拆分提示词模版：校验可用后快照入批次，未显式传字数时用模版建议值预填；
  // 拆分方式（字数/段落）随模版快照，诗词/幽默笑话模版默认按段落数归组
  let splitPrompt: string | undefined
  let splitMode: 'chars' | 'paragraphs' = 'chars'
  let paragraphsPerEpisode: number | undefined
  if (Number(body['split_template_id'])) {
    const tpl = await getTemplateUsable(Number(body['split_template_id']), user)
    if (!tpl) return badRequest(c, '拆分提示词模版不存在或不可用')
    splitPrompt = tpl.prompt
    if (!targetChars && tpl.defaultTargetChars) targetChars = tpl.defaultTargetChars
    if (tpl.splitMode === 'paragraphs') {
      splitMode = 'paragraphs'
      paragraphsPerEpisode = tpl.defaultParagraphs ?? undefined
    }
  }

  const ts = now()
  const items: Array<{ novelId: number; dramaId: number }> = []
  const uploaded: Array<{ file_name: string; drama_id: number; drama_title: string; novel_id: number; char_count: number; chapter_count: number }> = []
  const errors: Array<{ file_name: string; error: string }> = []

  for (const file of files) {
    try {
      if (!NOVEL_EXT.has(extOf(file.name))) throw new Error('仅支持 .txt / .md / .docx 格式')
      const buffer = await file.arrayBuffer()
      if (buffer.byteLength > NOVEL_MAX) throw new Error('小说文件不能超过 10MB')
      const content = await extractNovelText(file.name, buffer)
      if (!content) throw new Error('文件内容为空')

      const title = file.name.replace(/\.[^.]+$/, '')
      // 1) 自动建剧（与单部导入向导一致：标题取文件名）
      const dramaRes = await db.insert(schema.dramas).values({
        title,
        description: `批量导入（${file.name}）`,
        style: style || '3d',
        aspectRatio,
        status: 'draft',
        userId: user.id,
        createdAt: ts,
        updatedAt: ts,
      })
      const dramaId = getInsertId(dramaRes)
      // 2) 小说入库
      const novelRes = await db.insert(schema.novels).values({
        dramaId,
        title,
        fileName: file.name,
        content,
        charCount: countChars(content),
        chapterCount: detectChapters(content).length,
        splitStatus: 'uploaded',
        userId: user.id,
        createdAt: ts,
        updatedAt: ts,
      })
      const novelId = getInsertId(novelRes)
      items.push({ novelId, dramaId })
      uploaded.push({ file_name: file.name, drama_id: dramaId, drama_title: title, novel_id: novelId, char_count: countChars(content), chapter_count: detectChapters(content).length })
    } catch (err: any) {
      errors.push({ file_name: file.name, error: err?.message || '上传失败' })
    }
  }

  if (!items.length) return badRequest(c, `全部文件上传失败：${errors.map(e => `${e.file_name}(${e.error})`).join('；')}`)

  const batchId = await createBatch(user.id, items, targetChars, splitPrompt, { mode: batchMode, splitMode, paragraphsPerEpisode })
  let started = false
  // 两步走模式下拆分是第一步，建批即启动拆分；full 模式由 auto_start 决定是否立即启动
  if (batchMode === 'split_only' || String(body['auto_start'] || '') === '1') {
    started = startBatch(batchId).started
  }
  return created(c, { batch_id: batchId, mode: batchMode, status: started ? 'running' : 'pending', uploaded, errors })
})

// GET /production-batch — 我的批次列表
app.get('/', async (c) => {
  const user = c.get('user')
  return success(c, await listBatches(user.id))
})

// GET /production-batch/:id — 批次详情（条目 + 实时生产环节快照）
app.get('/:id', async (c) => {
  const found = await requireBatch(c)
  if (!found) return notFound(c, '批次不存在')
  const detail = await getBatchDetail(found.id)
  if (!detail) return notFound(c, '批次不存在')
  return success(c, detail)
})

// POST /production-batch/:id/start — 启动 / 续跑（失败条目会重试一次）
app.post('/:id/start', async (c) => {
  const blocked = aiCallGuard(c)
  if (blocked) return blocked
  const found = await requireBatch(c)
  if (!found) return notFound(c, '批次不存在')
  if (['running'].includes(found.row.status) && isBatchLoopActive(found.id)) {
    return success(c, { status: 'running', already_running: true })
  }
  const res = startBatch(found.id)
  return success(c, { status: 'running', ...res })
})

// POST /production-batch/:id/produce 实现（见上方注释）

app.post('/:id/produce', async (c) => {
  const blocked = aiCallGuard(c)
  if (blocked) return blocked
  const found = await requireBatch(c)
  if (!found) return notFound(c, '批次不存在')
  if (found.row.status === 'running' && isBatchLoopActive(found.id)) {
    return success(c, { status: 'running', already_running: true })
  }
  const res = await produceBatch(found.id)
  return success(c, { status: 'running', mode: 'full', ...res })
})

// POST /production-batch/:id/pause — 暂停（当前部在检查点停下，不打断在途上游任务）
app.post('/:id/pause', async (c) => {
  const found = await requireBatch(c)
  if (!found) return notFound(c, '批次不存在')
  const paused = pauseBatch(found.id)
  if (!paused) return badRequest(c, '当前没有正在运行的批次')
  return success(c, { status: 'paused' })
})

// POST /production-batch/:id/cancel — 取消（未开始的条目标记 cancelled，正在生产的部会在检查点停下）
app.post('/:id/cancel', async (c) => {
  const found = await requireBatch(c)
  if (!found) return notFound(c, '批次不存在')
  const cancelled = cancelBatch(found.id)
  if (!cancelled) return badRequest(c, '当前没有正在运行的批次')
  return success(c, { status: 'cancelled' })
})

export default app
