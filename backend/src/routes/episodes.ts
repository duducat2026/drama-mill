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
 * 分集门面路由（挂载于 /episodes）：新增 / 改字段 / 软删 / 详情 / 关联资产三查询
 * 流水线类端点（分镜、提取、视频提示词、timings 等）在 episodes-pipeline.ts 合并注册；
 * 建集核心逻辑复用 services/episode-create.ts（与小说拆分同一入口）
 */
import { Hono } from 'hono'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { badRequest, notFound, now, success } from '../utils/response.js'
import { toSnakeCase, toSnakeCaseArray } from '../utils/transform.js'
import { createEpisode } from '../services/episode-create.js'
import { getDramaOwned, getEpisodeFullOwned, getEpisodeOwned } from '../services/ownership.js'

const app = new Hono()

// PUT /episodes/:id — 白名单字段更新：allowed 里的 snake 键按原名透传，
// 只有 script_content 需要映射成 camel 列；空更新与非法分辨率写库前拦截
const SNAKE_TO_CAMEL: Record<string, string> = { script_content: 'scriptContent' }
const allowed = ['content', 'title', 'description', 'script_content', 'status', 'resolution']

app.put('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getEpisodeOwned(id, user)
  const body = await c.req.json()

  const patch: Record<string, any> = {}
  for (const key of allowed) {
    if (key in body) patch[SNAKE_TO_CAMEL[key] || key] = body[key]
  }
  if (!Object.keys(patch).length) return badRequest(c, 'no valid fields')
  if ('resolution' in patch && !['480p', '720p'].includes(patch.resolution)) {
    return badRequest(c, 'resolution 只支持 480p / 720p')
  }

  await db.update(schema.episodes).set({ ...patch, updatedAt: now() }).where(eq(schema.episodes.id, id))
  return success(c)
})

// DELETE /episodes/:id — 软删：打 deleted_at 标记后本集对全部查询不可达，
// 其分镜与生成任务行原样保留（仅失去入口，不做级联物理删除）
app.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getEpisodeOwned(id, user)
  await db.update(schema.episodes).set({ deletedAt: now(), updatedAt: now() })
    .where(eq(schema.episodes.id, id))
  return success(c)
})

// GET /episodes/:id — 单集真身（带 content/script_content MEDIUMTEXT）
// 正文体积大，只供剧集工作台按需拉当前集；进度/状态轮询一律走轻投影端点
app.get('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const { ep } = await getEpisodeFullOwned(id, user)
  if (!ep) return notFound(c, '剧集不存在')
  return success(c, toSnakeCase(ep))
})

// POST /episodes — 新增一集：项目归属校验后交给 createEpisode
// （配置未显式传入时按用户启用中的配置自动锁定）
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

// GET /episodes/:id/characters — 本集关联角色
// 链接表取 id 集合后按 id + 未软删下推 SQL，不再全表拉取回内存过滤
app.get('/:id/characters', async (c) => {
  const user = c.get('user')
  const episodeId = Number(c.req.param('id'))
  await getEpisodeOwned(episodeId, user)

  const bound = await db.select().from(schema.episodeCharacters)
    .where(eq(schema.episodeCharacters.episodeId, episodeId))
  const charIds = bound.map(l => l.characterId)
  const rows = await db.select().from(schema.characters)
    .where(and(inArray(schema.characters.id, charIds), isNull(schema.characters.deletedAt)))
  return success(c, toSnakeCaseArray(rows))
})

// GET /episodes/:id/scenes — 本集关联场景（同 characters 的下推口径）
app.get('/:id/scenes', async (c) => {
  const user = c.get('user')
  const episodeId = Number(c.req.param('id'))
  await getEpisodeOwned(episodeId, user)

  const bound = await db.select().from(schema.episodeScenes)
    .where(eq(schema.episodeScenes.episodeId, episodeId))
  const sceneIds = bound.map(l => l.sceneId)
  const rows = await db.select().from(schema.scenes)
    .where(and(inArray(schema.scenes.id, sceneIds), isNull(schema.scenes.deletedAt)))
  return success(c, toSnakeCaseArray(rows))
})

// GET /episodes/:id/props — 本集关联道具（同 characters 的下推口径）
app.get('/:id/props', async (c) => {
  const user = c.get('user')
  const episodeId = Number(c.req.param('id'))
  await getEpisodeOwned(episodeId, user)

  const bound = await db.select().from(schema.episodeProps)
    .where(eq(schema.episodeProps.episodeId, episodeId))
  const propIds = bound.map(l => l.propId)
  const rows = await db.select().from(schema.props)
    .where(and(inArray(schema.props.id, propIds), isNull(schema.props.deletedAt)))
  return success(c, toSnakeCaseArray(rows))
})

import episodesPipeline from './episodes-pipeline.js'
app.route('/', episodesPipeline)

export default app
