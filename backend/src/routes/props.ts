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
import { and, eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, badRequest, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { generatePropImageFor, batchGeneratePropImages } from '../services/asset-images.js'
import { ensurePropFinalPrompt } from '../services/final-prompt.js'
import { getDramaOwned, getPropOwned } from '../services/ownership.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

// POST /props — 手动新增道具（传入 episode_id 时关联到该集）
app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  if (!body.drama_id) return badRequest(c, 'drama_id required')
  if (!body.name?.trim()) return badRequest(c, 'name required')
  await getDramaOwned(Number(body.drama_id), user)
  const ts = now()
  const res = await db.insert(schema.props).values({
    name: body.name.trim(),
    type: body.type || '',
    description: body.description || '',
    dramaId: body.drama_id,
    createdAt: ts,
    updatedAt: ts,
  })
  const propId = getInsertId(res)
  if (body.episode_id) {
    const existing = await db.select().from(schema.episodeProps)
      .where(and(eq(schema.episodeProps.episodeId, Number(body.episode_id)), eq(schema.episodeProps.propId, propId)))
    if (!existing.length) {
      await db.insert(schema.episodeProps).values({ episodeId: Number(body.episode_id), propId, createdAt: ts })
    }
  }
  const [row] = await db.select().from(schema.props).where(eq(schema.props.id, propId))
  return created(c, toSnakeCase(row))
})

// DELETE /props/:id — 软删除
app.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getPropOwned(id, user)
  await db.update(schema.props).set({ deletedAt: now(), updatedAt: now() }).where(eq(schema.props.id, id))
  return success(c)
})

// PUT /props/:id — 更新道具（物品外貌/类型/最终提示词）
app.put('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getPropOwned(id, user)
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.name !== undefined) updates.name = body.name
  if (body.type !== undefined) updates.type = body.type
  if (body.description !== undefined) updates.description = body.description
  // 用户上传道具图：直接写入图片地址与本地路径
  if (body.image_url !== undefined) updates.imageUrl = body.image_url
  else if (body.imageUrl !== undefined) updates.imageUrl = body.imageUrl
  if (body.local_path !== undefined) updates.localPath = body.local_path
  else if (body.localPath !== undefined) updates.localPath = body.localPath
  // 手动编辑最终提示词时以传入值为准；未传入则保留原值（修改信息时不再自动置空）
  if (body.final_prompt !== undefined) updates.finalPrompt = body.final_prompt || null
  else if (body.finalPrompt !== undefined) updates.finalPrompt = body.finalPrompt || null
  await db.update(schema.props).set(updates).where(eq(schema.props.id, id))
  return success(c)
})

// POST /props/:id/generate-prompt — 独立生成/重新生成白底单品最终提示词（不生图）
app.post('/:id/generate-prompt', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const prop = await getPropOwned(id, user)
  if (!body.episode_id) return badRequest(c, 'episode_id is required')

  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, 'Episode not found')

  logTaskStart('FinalPrompt', 'prop-generate', { propId: id, episodeId: ep.id, force: !!body.force })
  const finalPrompt = await ensurePropFinalPrompt(prop, ep.id, !!body.force, { model: body.text_model, configId: body.text_config_id ?? undefined })
  if (!finalPrompt) {
    logTaskError('FinalPrompt', 'prop-generate', { propId: id, error: 'agent returned empty prompt' })
    return badRequest(c, '最终提示词生成失败，请重试')
  }
  logTaskSuccess('FinalPrompt', 'prop-generate', { propId: id })
  return success(c, { final_prompt: finalPrompt })
})

// POST /props/:id/generate-image — 生成道具白底单品图
app.post('/:id/generate-image', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  if (!body.episode_id) return badRequest(c, 'episode_id is required')
  await getPropOwned(id, user)
  try {
    logTaskStart('PropImage', 'generate', { propId: id, episodeId: Number(body.episode_id) })
    const genId = await generatePropImageFor(id, Number(body.episode_id), {
      model: body.model,
      configId: body.config_id ?? undefined,
      textModel: body.text_model,
      textConfigId: body.text_config_id ?? undefined,
    })
    logTaskSuccess('PropImage', 'generate', { propId: id, generationId: genId })
    return success(c, { image_generation_id: genId })
  } catch (err: any) {
    logTaskError('PropImage', 'generate', { propId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /props/batch-generate-images — 批量生成/重绘（传入选中的 prop_ids，不区分是否已有图）
app.post('/batch-generate-images', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const ids: number[] = body.prop_ids || []
  if (!body.episode_id) return badRequest(c, 'episode_id is required')
  if (!ids.length) return badRequest(c, 'prop_ids is required')
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, 'Episode not found')
  await getDramaOwned(ep.dramaId, user)
  const results = await batchGeneratePropImages(Number(body.episode_id), ids, {
    model: body.model,
    configId: body.config_id ?? undefined,
    textModel: body.text_model,
    textConfigId: body.text_config_id ?? undefined,
  })
  return success(c, { count: results.length, ids: results.map(r => r.task_id), items: results })
})

export default app
