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
import { eq, and, isNull, inArray, or, sql, desc } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest } from '../utils/response.js'
import { generateImage, generateVideo, retryTask, getTaskQueueStats } from '../services/generation.js'
import { localFileSize } from '../utils/storage.js'
import { getDramaOwned, getStoryboardOwned, ownedDramaIds } from '../services/ownership.js'
import { describeFailure } from '../services/failure-detail.js'
import { logTaskError, logTaskPayload, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import {
  getTaskOwned,
  loadTaskConfigBrief,
  parseJsonField,
  toMs,
  type TaskType,
} from './tasks-shared.js'
import { handleCloudQueue } from './tasks-cloud-queue.js'

const app = new Hono()

// POST /tasks — 发起生成任务（body.type: image | video）
app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const type = body.type as TaskType
  if (type !== 'image' && type !== 'video') return badRequest(c, 'type 必须为 image 或 video')

  // 归属校验：优先按项目，其次按分镜反查项目
  if (body.drama_id) await getDramaOwned(Number(body.drama_id), user)
  else if (body.storyboard_id) await getStoryboardOwned(Number(body.storyboard_id), user)

  if (type === 'image') {
    if (!body.prompt) return badRequest(c, 'prompt is required')
  } else {
    // 视频生成只保留多模态参考：校验素材上限与必填项
    const imgs = body.reference_image_urls?.length || 0
    const vids = body.reference_video_urls?.length || 0
    const auds = body.reference_audio_urls?.length || 0
    if (imgs > 9 || vids > 3 || auds > 3) {
      return badRequest(c, '参考素材超限：图片≤9、视频≤3、音频≤3')
    }
    if (auds > 0 && imgs + vids === 0) {
      return badRequest(c, '参考音频需要至少 1 个参考图片或视频')
    }
    if (imgs + vids + auds === 0 && !body.prompt) {
      return badRequest(c, '多模态参考模式需要至少一个参考素材或 prompt')
    }
  }

  try {
    // 集锁定的生成配置优先于请求指定；视频分辨率同样锁定到集
    let configId: number | undefined = body.config_id
    let episodeResolution: string | undefined
    if (body.storyboard_id) {
      const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, Number(body.storyboard_id)))
      if (sb) {
        const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId))
        const locked = type === 'image' ? ep?.imageConfigId : ep?.videoConfigId
        if (locked != null) configId = locked
        if (type === 'video' && ep?.resolution) episodeResolution = ep.resolution
      }
    }

    logTaskStart('TaskAPI', 'generate', {
      type,
      storyboardId: body.storyboard_id,
      sceneId: body.scene_id,
      characterId: body.character_id,
      dramaId: body.drama_id,
    })
    logTaskPayload('TaskAPI', 'request body', body)

    const id = type === 'image'
      ? await generateImage({
        storyboardId: body.storyboard_id,
        dramaId: body.drama_id,
        sceneId: body.scene_id,
        characterId: body.character_id,
        prompt: body.prompt,
        model: body.model,
        size: body.size,
        referenceImages: body.reference_images,
        frameType: body.frame_type,
        configId,
        userId: user.id,
      })
      : await generateVideo({
        storyboardId: body.storyboard_id,
        dramaId: body.drama_id,
        prompt: body.prompt,
        model: body.model,
        referenceMode: 'reference',
        referenceImageUrls: body.reference_image_urls,
        referenceVideoUrls: body.reference_video_urls,
        referenceAudioUrls: body.reference_audio_urls,
        generateAudio: body.generate_audio,
        duration: body.duration,
        aspectRatio: body.aspect_ratio,
        resolution: episodeResolution || body.resolution,
        configId,
        userId: user.id,
        noBalance: !!body.no_balance,
      })

    const [record] = await db.select().from(schema.sysTask)
      .where(eq(schema.sysTask.id, id))
    logTaskSuccess('TaskAPI', 'generate', { taskId: id, type, provider: record?.provider })
    return created(c, record)
  } catch (err: any) {
    logTaskError('TaskAPI', 'generate', { type, error: err.message })
    return badRequest(c, err.message)
  }
})

// GET /tasks/queue — 并发队列状态（执行中/排队中/上限），需注册在 /:id 之前
app.get('/queue', (c) => success(c, getTaskQueueStats()))

// GET /tasks/cloud-queue?model= — 用户侧云端排队状态（委托 tasks-cloud-queue 处理），
// 须注册在 /:id 之前，避免被参数路由截胡（Hono 按注册顺序匹配）
app.get('/cloud-queue', handleCloudQueue)

// GET /tasks/:id — 轮询任务状态
app.get('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const row = await getTaskOwned(id, user)
  return success(c, row || null)
})

// GET /tasks/:id/failure-detail — 失败原因诊断：把落库的 error_msg（可能是上游 HTML / JSON / 空串）
// 归一为「结论 + 修复建议 + 原始返回」，并附上本次调用实际使用的配置上下文（密钥只回掩码，不给明文）。
// 与 GET /tasks/:id 分开：轮询走轻字段，诊断是点开失败时才发的一次性请求。
app.get('/:id/failure-detail', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const row = await getTaskOwned(id, user)
  const params = parseJsonField(row.params)
  const configId = Number(params.configId) || null
  const cfg = configId ? await loadTaskConfigBrief(configId) : null
  const startMs = toMs(row.createdAt)
  const endMs = toMs(row.completedAt) || toMs(row.updatedAt) || Date.now()

  return success(c, {
    task_id: id,
    type: row.type,
    status: row.status,
    provider: row.provider || cfg?.provider || '',
    model: row.model || '',
    upstream_task_id: row.taskId || '',
    retry_count: row.retryCount ?? 0,
    is_config_test: !!params.configTest,
    prompt: row.prompt || '',
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    completed_at: row.completedAt || '',
    elapsed_ms: Number.isFinite(startMs) && endMs > startMs ? endMs - startMs : null,
    config: cfg,
    error: row.status === 'failed'
      ? describeFailure(row.errorMsg, { serviceType: row.type, provider: row.provider })
      : null,
  })
})

// GET /tasks — 按 type / storyboard_id / drama_id / status 过滤（仅当前用户项目的任务），WHERE 下推 + 分页；
// 响应 { items, pagination }；列表裁列剔除 params 大文本（保留 prompt 供任务抽屉展示）
app.get('/', async (c) => {
  const user = c.get('user')
  const type = c.req.query('type')
  const storyboardId = c.req.query('storyboard_id')
  const dramaId = c.req.query('drama_id')
  const status = c.req.query('status')
  const page = Number(c.req.query('page') || 1)
  const pageSize = Math.min(200, Number(c.req.query('page_size') || 50))

  const owned = await ownedDramaIds(user)
  const conds: any[] = []
  if (dramaId) {
    // 指定项目不属于当前用户时直接返回空（与原内存过滤语义一致，不报错）
    if (!owned.has(Number(dramaId))) {
      return success(c, { items: [], pagination: { page, page_size: pageSize, total: 0, total_pages: 0 } })
    }
    conds.push(eq(schema.sysTask.dramaId, Number(dramaId)))
  } else {
    // 任务归属：无项目关联的任务只放行「未落 user_id 的历史任务」与本人任务（设置页生成测试等落了 user_id），
    // 其余限定自有项目（替代全表拉取后内存过滤）
    const legacyCond = and(
      isNull(schema.sysTask.dramaId),
      sql`(${schema.sysTask.userId} IS NULL OR ${schema.sysTask.userId} = ${user.id})`,
    )
    conds.push(owned.size
      ? or(inArray(schema.sysTask.dramaId, [...owned]), legacyCond)
      : legacyCond)
  }
  if (type) conds.push(eq(schema.sysTask.type, type))
  if (storyboardId) conds.push(eq(schema.sysTask.storyboardId, Number(storyboardId)))
  if (status) {
    const list = status.split(',').map(s => s.trim()).filter(Boolean)
    if (list.length === 1) conds.push(eq(schema.sysTask.status, list[0]))
    else if (list.length > 1) conds.push(inArray(schema.sysTask.status, list))
  }
  const where = and(...conds)

  const [{ value: total }] = await db.select({ value: sql<number>`COUNT(*)` }).from(schema.sysTask).where(where)
  const rows = await db.select({
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
    .orderBy(desc(schema.sysTask.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  // 视频任务附带产物文件大小（字节）供前端展示；仅 completed 行走 fs.stat；行保持 camelCase 另加 snake 别名兼容前端
  const items = rows.map(r => {
    if (r.type !== 'video' || r.status !== 'completed') return r
    const size = localFileSize(r.localPath)
    return { ...r, videoSize: size, video_size: size }
  })
  return success(c, {
    items,
    pagination: { page, page_size: pageSize, total: Number(total), total_pages: Math.ceil(Number(total) / pageSize) },
  })
})

// POST /tasks/:id/retry — 重试失败任务（重置为 processing 后重新入队执行）
app.post('/:id/retry', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getTaskOwned(id, user)
  try {
    await retryTask(id)
    logTaskSuccess('TaskAPI', 'retry', { taskId: id })
    return success(c, { id })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// DELETE /tasks/:id
app.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getTaskOwned(id, user)
  await db.delete(schema.sysTask).where(eq(schema.sysTask.id, id))
  return success(c)
})

export default app
