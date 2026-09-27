/**
 * Drama Mill — AI 短剧生成平台
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
/*
 * Drama Mill — episodes 子路由：提取/视频提示词/耗时/分镜/生成任务/流水线状态
 */
import { Hono } from 'hono'
import { and, eq, isNull, inArray, or, sql, desc } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, notFound, badRequest, now } from '../utils/response.js'
import { toSnakeCaseArray, toSnakeCase } from '../utils/transform.js'
import { getEpisodePipelineSteps } from '../services/pipeline-status.js'
import { EXTRACT_TARGETS, getExtractionStatus, startExtraction, retryExtraction, type ExtractTarget } from '../services/extraction.js'
import { getVideoPromptBatchStatus, startVideoPromptBatch, retryVideoPromptBatch } from '../services/video-prompts.js'
import { localFileSize } from '../utils/storage.js'
import { getEpisodeOwned } from '../services/ownership.js'
import { getEpisodeTimings } from '../utils/stage-timing.js'

const app = new Hono()

// POST /episodes/:id/extract — 异步提取资产（target: characters | scenes | props），立即返回，前端轮询状态
app.post('/:id/extract', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const target = body.target as ExtractTarget
  if (!EXTRACT_TARGETS.includes(target)) return badRequest(c, 'target 必须是 characters / scenes / props')
  const { ep } = await getEpisodeOwned(id, user)
  const started = startExtraction(ep.id, ep.dramaId, target, { model: body.model || undefined, configId: body.config_id ?? undefined, userId: user.id })
  return success(c, { target, status: 'running', already_running: !started })
})

// GET /episodes/:id/extract-status — 查询三类资产提取任务状态（含失败原因与重试次数）
app.get('/:id/extract-status', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getEpisodeOwned(id, user)
  return success(c, getExtractionStatus(id))
})

// POST /episodes/:id/retry-extraction — 重试失败的资产提取（基于失败原因优化重新提取）
app.post('/:id/retry-extraction', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const target = body.target as ExtractTarget
  if (!EXTRACT_TARGETS.includes(target)) return badRequest(c, 'target 必须是 characters / scenes / props')
  const { ep } = await getEpisodeOwned(id, user)
  const started = retryExtraction(ep.id, ep.dramaId, target, { model: body.model || undefined, configId: body.config_id ?? undefined, userId: user.id })
  return success(c, { target, status: started ? 'running' : 'idle', already_running: !started })
})

// POST /episodes/:id/generate-video-prompts — 异步批量为缺少视频提示词的分镜生成（立即返回，前端轮询状态）
app.post('/:id/generate-video-prompts', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const { ep } = await getEpisodeOwned(id, user)
  const storyboardIds = Array.isArray(body.storyboard_ids)
    ? body.storyboard_ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
    : undefined
  const result = await startVideoPromptBatch(ep.id, ep.dramaId, { model: body.model || undefined, configId: body.config_id ?? undefined, userId: user.id }, storyboardIds)
  if (result.total === -1) return success(c, { status: 'running', already_running: true })
  if (!result.started) return success(c, { status: 'idle', total: 0 })
  return success(c, { status: 'running', total: result.total })
})

// GET /episodes/:id/video-prompts-status — 查询批量视频提示词任务状态（含每个分镜的独立状态与失败原因）
app.get('/:id/video-prompts-status', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getEpisodeOwned(id, user)
  return success(c, getVideoPromptBatchStatus(id))
})

// POST /episodes/:id/retry-video-prompts — 重试失败的提示词分镜（基于失败原因优化重新生成）
app.post('/:id/retry-video-prompts', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const { ep } = await getEpisodeOwned(id, user)
  const storyboardIds = Array.isArray(body.storyboard_ids)
    ? body.storyboard_ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
    : undefined
  const result = await retryVideoPromptBatch(ep.id, ep.dramaId, { model: body.model || undefined, configId: body.config_id ?? undefined, userId: user.id }, storyboardIds)
  if (result.total === -1) return success(c, { status: 'running', already_running: true })
  if (!result.started) return success(c, { status: 'idle', total: 0 })
  return success(c, { status: 'running', total: result.total })
})

// GET /episodes/:id/timings — 各阶段耗时明细与单集总耗时
app.get('/:id/timings', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getEpisodeOwned(id, user)
  const timings = await getEpisodeTimings(id)
  if (!timings) return notFound(c, '剧集不存在')
  return success(c, timings)
})

// GET /episodes/:episode_id/storyboards（每集页最热端点：链接表/资产表均 WHERE 下推；
// 每分镜只带 character_ids/prop_ids，不再重复嵌套完整资产对象，由前端用已单独加载的资产列表按 id 查找）
app.get('/:episode_id/storyboards', async (c) => {
  const user = c.get('user')
  const episodeId = Number(c.req.param('episode_id'))
  await getEpisodeOwned(episodeId, user)
  const rows = await db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .orderBy(schema.storyboards.storyboardNumber)
  const sbIds = rows.map(r => r.id)

  const charIdsByStoryboard = new Map<number, number[]>()
  const propIdsByStoryboard = new Map<number, number[]>()
  const videoAttemptCount = new Map<number, number>()
  if (sbIds.length) {
    const links = await db.select().from(schema.storyboardCharacters)
      .where(inArray(schema.storyboardCharacters.storyboardId, sbIds))
    for (const link of links) {
      const arr = charIdsByStoryboard.get(link.storyboardId) || []
      arr.push(link.characterId)
      charIdsByStoryboard.set(link.storyboardId, arr)
    }

    const propLinks = await db.select().from(schema.storyboardProps)
      .where(inArray(schema.storyboardProps.storyboardId, sbIds))
    for (const link of propLinks) {
      const arr = propIdsByStoryboard.get(link.storyboardId) || []
      arr.push(link.propId)
      propIdsByStoryboard.set(link.storyboardId, arr)
    }

    // 视频生成尝试次数：按 storyboard_id 分组计数 sys_task（type=video）
    const taskCounts = await db.select({
      storyboardId: schema.sysTask.storyboardId,
      cnt: sql<number>`COUNT(*)`,
    }).from(schema.sysTask)
      .where(and(inArray(schema.sysTask.storyboardId, sbIds), eq(schema.sysTask.type, 'video')))
      .groupBy(schema.sysTask.storyboardId)
    for (const r of taskCounts) {
      videoAttemptCount.set(r.storyboardId!, Number(r.cnt))
    }
  }

  return success(c, rows.map((row) => ({
    ...toSnakeCase(row),
    // 镜头视频文件大小（字节），前端格式化展示；无视频时为 null
    video_size: localFileSize(row.videoUrl || row.composedVideoUrl),
    character_ids: charIdsByStoryboard.get(row.id) || [],
    prop_ids: propIdsByStoryboard.get(row.id) || [],
    // 视频生成尝试次数（含失败重试）；无任务记录时为 0
    video_attempt_count: videoAttemptCount.get(row.id) || 0,
  })))
})

// GET /episodes/:id/pipeline-status — 流水线进度
// GET /episodes/:id/generation-tasks — 按集聚合 sys_task + video_merges（WHERE 下推 + 分页）
// sys_task 无 episode_id,通过 storyboard/scene/character/prop 关联键归属到当前集；裁列剔除 params 大文本
app.get('/:id/generation-tasks', async (c) => {
  const user = c.get('user')
  const episodeId = Number(c.req.param('id'))
  const page = Number(c.req.query('page') || 1)
  const pageSize = Math.min(200, Number(c.req.query('page_size') || 50))
  const { ep } = await getEpisodeOwned(episodeId, user)

  const sbs = await db.select({ id: schema.storyboards.id }).from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId))
  const storyboardIds = sbs.map(s => s.id)

  const epScenes = await db.select({ sceneId: schema.episodeScenes.sceneId }).from(schema.episodeScenes).where(eq(schema.episodeScenes.episodeId, episodeId))
  const sceneIdSet = new Set(epScenes.map(r => r.sceneId))
  // 兼容 scenes.episodeId 直挂的旧数据
  const directScenes = await db.select({ id: schema.scenes.id }).from(schema.scenes).where(eq(schema.scenes.episodeId, episodeId))
  directScenes.forEach(s => sceneIdSet.add(s.id))

  const epChars = await db.select({ characterId: schema.episodeCharacters.characterId }).from(schema.episodeCharacters).where(eq(schema.episodeCharacters.episodeId, episodeId))
  const characterIds = epChars.map(r => r.characterId)

  const dramaProps = await db.select({ id: schema.props.id }).from(schema.props).where(eq(schema.props.dramaId, ep.dramaId))
  const propIds = dramaProps.map(p => p.id)

  // 归属条件下推：drama_id + 四类关联键任一命中（替代拉项目全部任务再内存过滤）
  const orConds: any[] = []
  if (storyboardIds.length) orConds.push(inArray(schema.sysTask.storyboardId, storyboardIds))
  if (sceneIdSet.size) orConds.push(inArray(schema.sysTask.sceneId, [...sceneIdSet]))
  if (characterIds.length) orConds.push(inArray(schema.sysTask.characterId, characterIds))
  if (propIds.length) orConds.push(inArray(schema.sysTask.propId, propIds))

  let tasks: any[] = []
  let total = 0
  if (orConds.length) {
    const where = and(eq(schema.sysTask.dramaId, ep.dramaId), or(...orConds))
    const [{ value: cnt }] = await db.select({ value: sql<number>`COUNT(*)` }).from(schema.sysTask).where(where)
    total = Number(cnt)
    tasks = await db.select({
      id: schema.sysTask.id,
      type: schema.sysTask.type,
      storyboardId: schema.sysTask.storyboardId,
      dramaId: schema.sysTask.dramaId,
      sceneId: schema.sysTask.sceneId,
      characterId: schema.sysTask.characterId,
      propId: schema.sysTask.propId,
      provider: schema.sysTask.provider,
      prompt: schema.sysTask.prompt,
      model: schema.sysTask.model,
      taskId: schema.sysTask.taskId,
      resultUrl: schema.sysTask.resultUrl,
      localPath: schema.sysTask.localPath,
      status: schema.sysTask.status,
      errorMsg: schema.sysTask.errorMsg,
      retryCount: schema.sysTask.retryCount,
      userId: schema.sysTask.userId,
      createdAt: schema.sysTask.createdAt,
      updatedAt: schema.sysTask.updatedAt,
      completedAt: schema.sysTask.completedAt,
    }).from(schema.sysTask)
      .where(where)
      .orderBy(desc(schema.sysTask.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
  }

  const merges = (await db.select().from(schema.videoMerges)
    .where(and(eq(schema.videoMerges.episodeId, episodeId), isNull(schema.videoMerges.deletedAt))))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 20)

  return success(c, {
    tasks: toSnakeCaseArray(tasks),
    merges: toSnakeCaseArray(merges),
    pagination: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
  })
})

app.get('/:id/pipeline-status', async (c) => {
  const user = c.get('user')
  const episodeId = Number(c.req.param('id'))
  await getEpisodeOwned(episodeId, user)
  const steps = await getEpisodePipelineSteps(episodeId)
  if (!steps) return notFound(c, 'Episode not found')
  // 同步附带各阶段耗时（流水线步骤名 → 耗时阶段名映射，分镜拆分两侧命名不同）
  const timings = await getEpisodeTimings(episodeId)
  const durationByStage = new Map((timings?.stages || []).map(s => [s.stage, s.duration_ms]))
  const STEP_STAGE_MAP: Record<string, string> = { extract_storyboards: 'storyboard_split' }
  const stepsWithDuration = Object.fromEntries(Object.entries(steps).map(([key, step]) => [
    key,
    { ...step, duration_ms: durationByStage.get(STEP_STAGE_MAP[key] || key) ?? null },
  ]))
  return success(c, { episode_id: episodeId, steps: stepsWithDuration, total_duration_ms: timings?.total_duration_ms ?? null })
})


export default app

