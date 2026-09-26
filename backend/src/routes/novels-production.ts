/*
 * Drama Mill — novels 子路由：项目创建 + 分集拆分 + 拆分进度
 */
import { Hono } from 'hono'
import { eq, and, isNull, inArray } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { success, created, badRequest, notFound } from '../utils/response.js'
import { countChars, detectChapters, detectParagraphs, preSplitNovel, startNovelSplit, getNovelSplitStatus } from '../services/novel-split.js'
import { getDramaOwned, getNovelOwned } from '../services/ownership.js'
import { getTemplateUsable } from './novel-split-templates.js'
import { createBatch, startBatch } from '../services/production-batch.js'

const app = new Hono()

// POST /novels/create-projects — 批量选中小说创建项目：逐部建剧（已建项目复用）并入批次自动生产
app.post('/create-projects', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const ids: number[] = Array.isArray(body.novel_ids) ? body.novel_ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : []
  if (!ids.length) return badRequest(c, 'novel_ids is required')
  if (ids.length > 100) return badRequest(c, '单次最多选择 100 部小说')
  const style = body.style ? String(body.style) : ''
  const aspectRatio = ['16:9', '9:16', '1:1', 'adaptive'].includes(body.aspect_ratio) ? body.aspect_ratio : '16:9'
  let targetChars = Number(body.target_chars) > 0 ? Number(body.target_chars) : undefined

  let splitPrompt: string | undefined
  let splitTemplateId: number | undefined
  let splitMode: 'chars' | 'paragraphs' = body.split_mode === 'paragraphs' ? 'paragraphs' : 'chars'
  let paragraphsPerEpisode = Number(body.paragraphs_per_episode) > 0 ? Math.round(Number(body.paragraphs_per_episode)) : undefined
  if (Number(body.split_template_id)) {
    const tpl = await getTemplateUsable(Number(body.split_template_id), user)
    if (!tpl) return badRequest(c, '拆分提示词模版不存在或不可用')
    splitPrompt = tpl.prompt
    splitTemplateId = tpl.id
    if (!targetChars && tpl.defaultTargetChars) targetChars = tpl.defaultTargetChars
    if (body.split_mode === undefined) splitMode = tpl.splitMode === 'paragraphs' ? 'paragraphs' : 'chars'
    if (paragraphsPerEpisode === undefined && tpl.defaultParagraphs) paragraphsPerEpisode = tpl.defaultParagraphs
  }

  const novels = await db.select().from(schema.novels)
    .where(and(inArray(schema.novels.id, [...new Set(ids)]), isNull(schema.novels.deletedAt)))
  const owned = novels.filter(n => n.userId === user.id)
  if (!owned.length) return badRequest(c, '没有可创建项目的小说')
  const ownedMap = new Map(owned.map(n => [n.id, n]))

  const ts = now()
  const items: { novelId: number; dramaId: number }[] = []
  const results: { novel_id: number; drama_id: number; drama_title: string; reused: boolean }[] = []
  const errors: { novel_id: number; error: string }[] = []

  for (const novelId of [...new Set(ids)]) {
    const novel = ownedMap.get(novelId)
    if (!novel) { errors.push({ novel_id: novelId, error: '小说不存在或无权限' }); continue }
    try {
      if (novel.dramaId) {
        const [drama] = await db.select({ id: schema.dramas.id, title: schema.dramas.title, deletedAt: schema.dramas.deletedAt }).from(schema.dramas).where(eq(schema.dramas.id, novel.dramaId))
        if (drama && !drama.deletedAt) {
          items.push({ novelId: novel.id, dramaId: drama.id })
          results.push({ novel_id: novel.id, drama_id: drama.id, drama_title: drama.title, reused: true })
          continue
        }
      }
      const dramaRes = await db.insert(schema.dramas).values({
        title: novel.title,
        description: `小说导入（${novel.fileName || novel.title}）`,
        style: style || '3d',
        aspectRatio,
        status: 'draft',
        userId: user.id,
        createdAt: ts,
        updatedAt: ts,
      })
      const dramaId = getInsertId(dramaRes)
      await db.update(schema.novels).set({ dramaId, updatedAt: ts }).where(eq(schema.novels.id, novel.id))
      items.push({ novelId: novel.id, dramaId })
      results.push({ novel_id: novel.id, drama_id: dramaId, drama_title: novel.title, reused: false })
    } catch (err: any) {
      errors.push({ novel_id: novelId, error: err?.message || '创建项目失败' })
    }
  }

  if (!items.length) return badRequest(c, `全部小说创建项目失败：${errors.map(e => `#${e.novel_id}(${e.error})`).join('；')}`)
  const batchMode: 'full' | 'split_only' = body.mode === 'split_only' ? 'split_only' : 'full'
  const batchId = await createBatch(user.id, items, targetChars, splitPrompt, { mode: batchMode, splitMode, paragraphsPerEpisode })
  let started = false
  if (body.auto_start || batchMode === 'split_only') started = startBatch(batchId).started
  return created(c, { batch_id: batchId, mode: batchMode, status: started ? 'running' : 'pending', split_template_id: splitTemplateId ?? null, split_mode: splitMode, created: results, errors })
})

// POST /novels/:id/split — 启动异步拆分（立即返回）
app.post('/:id/split', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const novel = await getNovelOwned(id, user)
  if (!novel.dramaId) return badRequest(c, '小说尚未创建项目，请先创建项目后再拆分')
  await getDramaOwned(novel.dramaId, user)

  let splitPrompt: string | undefined
  let splitTemplateId: number | undefined
  let targetChars = Number(body.target_chars) || undefined
  let splitMode: 'chars' | 'paragraphs' = body.split_mode === 'paragraphs' ? 'paragraphs' : 'chars'
  let paragraphsPerEpisode = Number(body.paragraphs_per_episode) > 0 ? Math.round(Number(body.paragraphs_per_episode)) : undefined
  if (Number(body.template_id)) {
    const tpl = await getTemplateUsable(Number(body.template_id), user)
    if (!tpl) return badRequest(c, '拆分提示词模版不存在或不可用')
    splitPrompt = tpl.prompt
    splitTemplateId = tpl.id
    if (!targetChars && tpl.defaultTargetChars) targetChars = tpl.defaultTargetChars
    if (body.split_mode === undefined) splitMode = tpl.splitMode === 'paragraphs' ? 'paragraphs' : 'chars'
    if (paragraphsPerEpisode === undefined && tpl.defaultParagraphs) paragraphsPerEpisode = tpl.defaultParagraphs
  }

  const started = await startNovelSplit(id, {
    targetChars,
    model: body.model || undefined,
    configId: body.config_id ?? undefined,
    userId: user.id,
    splitPrompt,
    splitTemplateId,
    splitMode,
    paragraphsPerEpisode,
  })
  if (!started) return success(c, { status: 'splitting', already_running: true })
  return success(c, { status: 'splitting', started: true, split_mode: splitMode })
})

// POST /novels/:id/pre-split — 文档拆分：按提示词模版或手动参数把大文档拆成多个独立小说入库
app.post('/:id/pre-split', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const novel = await getNovelOwned(id, user)
  if (novel.dramaId) return badRequest(c, '该小说已创建项目，不可拆分。请删除项目后重试或对未建项目的小说操作')

  let splitMode: 'chars' | 'paragraphs' = body.split_mode === 'paragraphs' ? 'paragraphs' : body.split_mode === 'chars' ? 'chars' : 'paragraphs'
  let targetChars = Number(body.target_chars) > 0 ? Number(body.target_chars) : undefined
  let paragraphsPerNovel = Number(body.paragraphs_per_novel) > 0 ? Math.round(Number(body.paragraphs_per_novel)) : undefined
  let splitTemplateId: number | undefined
  if (Number(body.split_template_id)) {
    const tpl = await getTemplateUsable(Number(body.split_template_id), user)
    if (!tpl) return badRequest(c, '拆分提示词模版不存在或不可用')
    splitTemplateId = tpl.id
    if (body.split_mode === undefined) splitMode = tpl.splitMode === 'paragraphs' ? 'paragraphs' : 'chars'
    if (targetChars === undefined && tpl.defaultTargetChars) targetChars = tpl.defaultTargetChars
    if (paragraphsPerNovel === undefined && tpl.defaultParagraphs) paragraphsPerNovel = tpl.defaultParagraphs
  }
  const targetNovels = Number(body.target_novels) > 0 ? Math.round(Number(body.target_novels)) : undefined

  if (splitMode === 'paragraphs' && !paragraphsPerNovel && !targetNovels) {
    return badRequest(c, '需指定每份段落数或目标份数，或选择提示词模版')
  }
  const titlePrefix = (String(body.title_prefix || '').trim() || novel.title).slice(0, 50)

  const paragraphCount = detectParagraphs(novel.content).length
  const chapterCount = detectChapters(novel.content).length
  const chunks = preSplitNovel(novel.content, { paragraphsPerNovel, targetNovels, titlePrefix, splitMode, targetChars })
  if (chunks.length <= 1) return badRequest(c, splitMode === 'chars'
    ? '文档章节数不足以拆分（章节过少或目标字数过大，请减小每份目标字数）'
    : '文档段落数不足以拆分（段落不足或参数过大，请减小每份段落数或目标份数）')
  if (chunks.length > 100) return badRequest(c, `拆分份数过多（${chunks.length} 份），单次最多 100 份，请增大每份字数/段落数或目标份数`)

  const ts = now()
  const createdNovels: { id: number; title: string; char_count: number; paragraph_count: number; chapter_count: number }[] = []
  for (const chunk of chunks) {
    const res = await db.insert(schema.novels).values({
      title: chunk.title,
      fileName: `${chunk.title}.txt`,
      content: chunk.content,
      charCount: chunk.charCount,
      chapterCount: detectChapters(chunk.content).length,
      splitStatus: 'uploaded',
      splitTemplateId: splitTemplateId ?? undefined,
      userId: user.id,
      createdAt: ts,
      updatedAt: ts,
    })
    createdNovels.push({ id: getInsertId(res), title: chunk.title, char_count: chunk.charCount, paragraph_count: chunk.paragraphCount, chapter_count: chunk.chapterCount ?? 0 })
  }
  const deleteSource = body.delete_source !== false && body.delete_source !== 0
  if (deleteSource) {
    await db.update(schema.novels).set({ deletedAt: ts, updatedAt: ts }).where(eq(schema.novels.id, id))
  }
  return created(c, {
    source_novel_id: id,
    source_deleted: deleteSource,
    source_paragraph_count: paragraphCount,
    source_chapter_count: chapterCount,
    split_mode: splitMode,
    split_template_id: splitTemplateId ?? null,
    created: createdNovels,
  })
})

// GET /novels/:id/split-status — 拆分进度与已建集预览
app.get('/:id/split-status', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const novel = await getNovelOwned(id, user)
  if (novel.dramaId) await getDramaOwned(novel.dramaId, user)
  const status = await getNovelSplitStatus(id)
  if (!status) return notFound(c, '小说不存在')
  return success(c, status)
})

export default app
