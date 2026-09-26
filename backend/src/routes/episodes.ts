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
import { and, eq, isNull, inArray, or, sql, desc } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, notFound, badRequest, now } from '../utils/response.js'
import { toSnakeCaseArray, toSnakeCase } from '../utils/transform.js'
import { createEpisode } from '../services/episode-create.js'
import { getEpisodePipelineSteps } from '../services/pipeline-status.js'
import { EXTRACT_TARGETS, getExtractionStatus, startExtraction, retryExtraction, type ExtractTarget } from '../services/extraction.js'
import { getVideoPromptBatchStatus, startVideoPromptBatch, retryVideoPromptBatch } from '../services/video-prompts.js'
import { localFileSize } from '../utils/storage.js'
import { getDramaOwned, getEpisodeOwned, getEpisodeFullOwned } from '../services/ownership.js'
import { getEpisodeTimings } from '../utils/stage-timing.js'

const app = new Hono()

// POST /episodes — Create a new episode
app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  if (!body.drama_id) return badRequest(c, 'drama_id required')
  await getDramaOwned(Number(body.drama_id), user)
  try {
    const ep = await createEpisode(Number(body.drama_id), {
      title: body.title,
      resolution: body.resolution,
      imageConfigId: body.image_config_id,
      videoConfigId: body.video_config_id,
    }, user.id)
    return success(c, ep)
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// PUT /episodes/:id - Update episode fields
app.put('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getEpisodeOwned(id, user)
  const body = await c.req.json()

  const allowed = ['content', 'script_content', 'title', 'description', 'status', 'resolution']
  const updates: Record<string, any> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }
  if (Object.keys(updates).length === 0) return badRequest(c, 'no valid fields')
  if ('resolution' in updates && !['480p', '720p'].includes(updates.resolution)) {
    return badRequest(c, 'resolution 只支持 480p / 720p')
  }

  // Map snake_case to camelCase for drizzle
  const drizzleUpdates: Record<string, any> = { updatedAt: now() }
  if ('content' in updates) drizzleUpdates.content = updates.content
  if ('script_content' in updates) drizzleUpdates.scriptContent = updates.script_content
  if ('title' in updates) drizzleUpdates.title = updates.title
  if ('description' in updates) drizzleUpdates.description = updates.description
  if ('status' in updates) drizzleUpdates.status = updates.status
  if ('resolution' in updates) drizzleUpdates.resolution = updates.resolution

  await db.update(schema.episodes).set(drizzleUpdates).where(eq(schema.episodes.id, id))
  return success(c)
})

// DELETE /episodes/:id - Soft delete episode（其分镜/生成记录保留但不可达）
app.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getEpisodeOwned(id, user)
  await db.update(schema.episodes).set({ deletedAt: now(), updatedAt: now() })
    .where(eq(schema.episodes.id, id))
  return success(c)
})

// GET /episodes/:id — 单集详情（含 content/script_content MEDIUMTEXT，仅供剧集页按需加载当前集；
// 其余状态/进度类端点走 getEpisodeOwned 轻投影，不再把正文带入轮询请求）
app.get('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const { ep } = await getEpisodeFullOwned(id, user)
  return success(c, toSnakeCase(ep))
})

// GET /episodes/:id/characters — characters linked to this episode（WHERE 下推，不再全表拉取后内存过滤）
app.get('/:id/characters', async (c) => {
  const user = c.get('user')
  const episodeId = Number(c.req.param('id'))
  await getEpisodeOwned(episodeId, user)
  const links = await db.select().from(schema.episodeCharacters)
    .where(eq(schema.episodeCharacters.episodeId, episodeId))
  const charIds = links.map(l => l.characterId)
  if (!charIds.length) return success(c, [])
  const result = await db.select().from(schema.characters)
    .where(and(inArray(schema.characters.id, charIds), isNull(schema.characters.deletedAt)))
  return success(c, toSnakeCaseArray(result))
})

// GET /episodes/:id/scenes — scenes linked to this episode（WHERE 下推）
app.get('/:id/scenes', async (c) => {
  const user = c.get('user')
  const episodeId = Number(c.req.param('id'))
  await getEpisodeOwned(episodeId, user)
  const links = await db.select().from(schema.episodeScenes)
    .where(eq(schema.episodeScenes.episodeId, episodeId))
  const sceneIds = links.map(l => l.sceneId)
  if (!sceneIds.length) return success(c, [])
  const result = await db.select().from(schema.scenes)
    .where(and(inArray(schema.scenes.id, sceneIds), isNull(schema.scenes.deletedAt)))
  return success(c, toSnakeCaseArray(result))
})

// GET /episodes/:id/props — props linked to this episode（WHERE 下推）
app.get('/:id/props', async (c) => {
  const user = c.get('user')
  const episodeId = Number(c.req.param('id'))
  await getEpisodeOwned(episodeId, user)
  const links = await db.select().from(schema.episodeProps)
    .where(eq(schema.episodeProps.episodeId, episodeId))
  const propIds = links.map(l => l.propId)
  if (!propIds.length) return success(c, [])
  const result = await db.select().from(schema.props)
    .where(and(inArray(schema.props.id, propIds), isNull(schema.props.deletedAt)))
  return success(c, toSnakeCaseArray(result))
})

import episodesPipeline from "./episodes-pipeline.js"
app.route("/", episodesPipeline)

export default app
