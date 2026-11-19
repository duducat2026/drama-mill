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
 * 角色资产接口：建档、编辑、三视图立绘生成（单/批）、最终提示词、软删
 * 软删只打 deletedAt，角色被历史分镜引用，行必须留在库里
 */
import { Hono } from 'hono'
import { and, eq, inArray } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, badRequest, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { generateCharacterImageFor, batchGenerateCharacterImages } from '../services/asset-images.js'
import { ensureCharacterFinalPrompt } from '../services/final-prompt.js'
import { getDramaOwned, getCharacterOwned, assertEpisodeInDrama } from '../services/ownership.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

// PUT 可改的普通字段：snake_case 优先、camelCase 兜底，出现才覆盖
const EDITABLE_FIELDS = ['name', 'role', 'description', 'appearance', 'styling', 'imageUrl', 'localPath']

// POST /characters — 手动建档；带 episode_id 就顺手挂到该集
app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  if (!body.drama_id) return badRequest(c, 'drama_id required')
  if (!body.name?.trim()) return badRequest(c, 'name required')
  await getDramaOwned(Number(body.drama_id), user)
  // 带 episode_id 时必须属于该项目：否则会把角色挂到他人剧集上
  if (body.episode_id) await assertEpisodeInDrama(Number(body.episode_id), Number(body.drama_id), user)
  const ts = now()
  const res = await db.insert(schema.characters).values({
    styling: body.styling || '',
    appearance: body.appearance || '',
    description: body.description || '',
    role: body.role || '',
    name: body.name.trim(),
    dramaId: body.drama_id,
    createdAt: ts,
    updatedAt: ts,
  })
  const charId = getInsertId(res)
  // 关联表先查再插，重复挂集不产生重复行
  if (body.episode_id) {
    const existing = await db.select().from(schema.episodeCharacters)
      .where(and(eq(schema.episodeCharacters.episodeId, Number(body.episode_id)), eq(schema.episodeCharacters.characterId, charId)))
    if (!existing.length) {
      await db.insert(schema.episodeCharacters).values({ episodeId: Number(body.episode_id), characterId: charId, createdAt: ts })
    }
  }
  const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, charId))
  return created(c, toSnakeCase(row))
})

// PUT /characters/:id — 增量更新，两种命名形都接受
app.put('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getCharacterOwned(id, user)
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  for (const key of EDITABLE_FIELDS) {
    const snakeKey = key.replace(/[A-Z]/g, m => '_' + m.toLowerCase())
    if (snakeKey in body) updates[key] = body[snakeKey]
    else if (key in body) updates[key] = body[key]
  }
  // finalPrompt 只在显式传时覆盖，空串视为清除；改其他字段不会连带清空它
  if (body.final_prompt !== undefined) updates.finalPrompt = body.final_prompt || null
  else if (body.finalPrompt !== undefined) updates.finalPrompt = body.finalPrompt || null
  await db.update(schema.characters).set(updates).where(eq(schema.characters.id, id))
  return success(c)
})

// DELETE /characters/:id — 软删：只打 deletedAt 戳
app.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getCharacterOwned(id, user)
  await db.update(schema.characters).set({ deletedAt: now() }).where(eq(schema.characters.id, id))
  return success(c)
})

// POST /characters/:id/generate-image — 提交单个角色立绘生成任务
app.post('/:id/generate-image', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  if (!body.episode_id) return badRequest(c, 'episode_id is required')
  const char = await getCharacterOwned(id, user)
  // 集必须属于角色所在项目：否则会拿他人的集锁定配置与归属建任务
  await assertEpisodeInDrama(Number(body.episode_id), char.dramaId, user)
  try {
    logTaskStart('CharacterImage', 'generate', { episodeId: Number(body.episode_id), characterId: id })
    const genId = await generateCharacterImageFor(id, Number(body.episode_id), {
      model: body.model,
      configId: body.config_id ?? undefined,
      textModel: body.text_model,
      textConfigId: body.text_config_id ?? undefined,
    })
    logTaskSuccess('CharacterImage', 'generate', { generationId: genId, characterId: id })
    return success(c, { image_generation_id: genId })
  } catch (err: any) {
    logTaskError('CharacterImage', 'generate', { characterId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /characters/:id/generate-prompt — 只重生成三视图最终提示词，不动图
app.post('/:id/generate-prompt', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const char = await getCharacterOwned(id, user)
  if (!body.episode_id) return badRequest(c, 'episode_id is required')

  // 集归属 + 与角色同项目双重校验（直接查库无法判定越权）
  const ep = await assertEpisodeInDrama(Number(body.episode_id), char.dramaId, user)

  logTaskStart('FinalPrompt', 'character-generate', { force: !!body.force, episodeId: ep.id, characterId: id })
  const finalPrompt = await ensureCharacterFinalPrompt(char, ep.id, !!body.force, { model: body.text_model, configId: body.text_config_id ?? undefined, userId: user.id })
  if (!finalPrompt) {
    logTaskError('FinalPrompt', 'character-generate', { characterId: id, error: 'agent returned empty prompt' })
    return badRequest(c, '最终提示词生成失败，请重试')
  }
  logTaskSuccess('FinalPrompt', 'character-generate', { characterId: id })
  return success(c, { final_prompt: finalPrompt })
})

// POST /characters/batch-generate-images — 按勾选集合批量提图（可不带 ids 全量）
app.post('/batch-generate-images', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const ids: number[] = (body.character_ids || []).map(Number).filter(Number.isFinite)
  if (!body.episode_id) return badRequest(c, 'episode_id is required')
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, 'Episode not found')
  await getDramaOwned(ep.dramaId, user)
  // 勾选集合必须全部属于本集所在项目：只校验集归属堵不住跨项目资产 ID
  if (ids.length) {
    const rows = await db.select({ id: schema.characters.id, dramaId: schema.characters.dramaId })
      .from(schema.characters).where(inArray(schema.characters.id, ids))
    if (rows.some(r => r.dramaId !== ep.dramaId)) return badRequest(c, '包含不属于当前项目的角色')
  }
  const results = await batchGenerateCharacterImages(ep.id, ids, {
    model: body.model,
    configId: body.config_id ?? undefined,
    textModel: body.text_model,
    textConfigId: body.text_config_id ?? undefined,
  })
  return success(c, { count: results.length, ids: results.map(r => r.task_id), items: results })
})

export default app
