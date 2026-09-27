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
 * 场景资产接口：手动建档、编辑、生图（单/批）、生成最终提示词、软删
 * 删除一律走 deletedAt 打标，历史生成记录要留给成本追溯
 */
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, badRequest, now } from '../utils/response.js'
import { generateSceneImageFor, batchGenerateSceneImages } from '../services/asset-images.js'
import { ensureSceneFinalPrompt } from '../services/final-prompt.js'
import { getDramaOwned, getSceneOwned } from '../services/ownership.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

// POST /scenes — 手动建档；带 episode_id 就顺手挂到该集
app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  if (!body.drama_id) return badRequest(c, 'drama_id required')
  if (!body.location?.trim()) return badRequest(c, 'location required')
  await getDramaOwned(Number(body.drama_id), user)
  const ts = now()
  const res = await db.insert(schema.scenes).values({
    lighting: body.lighting || '',
    prompt: body.prompt || body.description || body.location,
    time: body.time || '',
    location: body.location.trim(),
    episodeId: body.episode_id,
    dramaId: body.drama_id,
    createdAt: ts,
    updatedAt: ts,
  })
  const sceneId = getInsertId(res)
  // 关联表先查再插，重复挂集不报错也不产生重复行
  if (body.episode_id) {
    const existing = await db.select().from(schema.episodeScenes)
      .where(and(eq(schema.episodeScenes.episodeId, Number(body.episode_id)), eq(schema.episodeScenes.sceneId, sceneId)))
    if (!existing.length) {
      await db.insert(schema.episodeScenes).values({ episodeId: Number(body.episode_id), sceneId, createdAt: ts })
    }
  }
  const [result] = await db.select().from(schema.scenes)
    .where(eq(schema.scenes.id, sceneId))
  return created(c, result)
})

// PUT /scenes/:id — 出现哪个 snake/camel 字段改哪个，双形兼容前端两种写法
app.put('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getSceneOwned(id, user)
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.location !== undefined) updates.location = body.location
  if (body.time !== undefined) updates.time = body.time
  if (body.prompt !== undefined) updates.prompt = body.prompt
  if (body.description !== undefined) updates.prompt = body.description
  if (body.lighting !== undefined) updates.lighting = body.lighting
  // 用户上传现成场景图：直落地址并把状态标成完成，跳过生图
  const uploadedImage = body.image_url ?? body.imageUrl
  if (uploadedImage !== undefined) {
    updates.imageUrl = uploadedImage
    if (uploadedImage) updates.status = 'completed'
  }
  if (body.local_path !== undefined) updates.localPath = body.local_path
  else if (body.localPath !== undefined) updates.localPath = body.localPath
  // finalPrompt 只在显式传时覆盖，空串视为清除；改其他字段不会连带清空它
  if (body.final_prompt !== undefined) updates.finalPrompt = body.final_prompt || null
  else if (body.finalPrompt !== undefined) updates.finalPrompt = body.finalPrompt || null
  await db.update(schema.scenes).set(updates).where(eq(schema.scenes.id, id))
  return success(c)
})

// POST /scenes/:id/generate-image — 提交单个场景图生成任务
app.post('/:id/generate-image', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  if (!body.episode_id) return badRequest(c, 'episode_id is required')
  await getSceneOwned(id, user)
  try {
    logTaskStart('SceneImage', 'generate', { sceneId: id, episodeId: Number(body.episode_id) })
    const genId = await generateSceneImageFor(id, Number(body.episode_id), {
      model: body.model,
      configId: body.config_id ?? undefined,
      textModel: body.text_model,
      textConfigId: body.text_config_id ?? undefined,
    })
    logTaskSuccess('SceneImage', 'generate', { sceneId: id, generationId: genId })
    return success(c, { image_generation_id: genId })
  } catch (err: any) {
    // 提交即失败（配置/额度问题）：把场景标 failed，前端列表立刻可见
    logTaskError('SceneImage', 'generate', { sceneId: id, error: err.message })
    await db.update(schema.scenes).set({ status: 'failed', updatedAt: now() }).where(eq(schema.scenes.id, id))
    return badRequest(c, err.message)
  }
})

// POST /scenes/batch-generate-images — 按勾选集合批量提图，已有图的也允许重绘
app.post('/batch-generate-images', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const ids: number[] = body.scene_ids || []
  if (!body.episode_id) return badRequest(c, 'episode_id is required')
  if (!ids.length) return badRequest(c, 'scene_ids is required')
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, 'Episode not found')
  await getDramaOwned(ep.dramaId, user)
  const results = await batchGenerateSceneImages(Number(body.episode_id), ids, {
    model: body.model,
    configId: body.config_id ?? undefined,
    textModel: body.text_model,
    textConfigId: body.text_config_id ?? undefined,
  })
  return success(c, { count: results.length, ids: results.map(r => r.task_id), items: results })
})

// POST /scenes/:id/generate-prompt — 只重生成固定视角最终提示词，不动图
app.post('/:id/generate-prompt', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const scene = await getSceneOwned(id, user)
  if (!body.episode_id) return badRequest(c, 'episode_id is required')

  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, 'Episode not found')

  logTaskStart('FinalPrompt', 'scene-generate', { sceneId: id, episodeId: ep.id, force: !!body.force })
  const finalPrompt = await ensureSceneFinalPrompt(scene, ep.id, !!body.force, { model: body.text_model, configId: body.text_config_id ?? undefined })
  if (!finalPrompt) {
    logTaskError('FinalPrompt', 'scene-generate', { sceneId: id, error: 'agent returned empty prompt' })
    return badRequest(c, '最终提示词生成失败，请重试')
  }
  logTaskSuccess('FinalPrompt', 'scene-generate', { sceneId: id })
  return success(c, { final_prompt: finalPrompt })
})

// DELETE /scenes/:id — 软删：打 deletedAt 戳，行留在库里
app.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getSceneOwned(id, user)
  await db.update(schema.scenes).set({ deletedAt: now(), updatedAt: now() }).where(eq(schema.scenes.id, id))
  return success(c)
})

export default app
