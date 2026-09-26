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
 * 项目素材子路由（挂载于 /dramas）— 素材图片状态 + 角色/剧集批量保存
 * 路径按注册顺序生效：/:id/assets-status 先于门面 dramas.ts 的 /:id 通配路由
 */
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, now } from '../utils/response.js'
import { getDramaOwned } from '../services/ownership.js'

const app = new Hono()

// GET /dramas/:id/assets-status — 轻量素材图片状态（供素材生图轮询，替代全量项目树）
app.get('/:id/assets-status', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getDramaOwned(id, user)
  const [chars, scns, prps] = await Promise.all([
    db.select({ id: schema.characters.id, imageUrl: schema.characters.imageUrl, localPath: schema.characters.localPath })
      .from(schema.characters).where(eq(schema.characters.dramaId, id)),
    db.select({ id: schema.scenes.id, imageUrl: schema.scenes.imageUrl, localPath: schema.scenes.localPath })
      .from(schema.scenes).where(eq(schema.scenes.dramaId, id)),
    db.select({ id: schema.props.id, imageUrl: schema.props.imageUrl, localPath: schema.props.localPath })
      .from(schema.props).where(eq(schema.props.dramaId, id)),
  ])
  const slim = (rows: any[]) => rows.map(r => ({ id: r.id, image_url: r.imageUrl || null, local_path: r.localPath || null }))
  return success(c, { characters: slim(chars), scenes: slim(scns), props: slim(prps) })
})

// PUT /dramas/:id/characters - Save characters
app.put('/:id/characters', async (c) => {
  const user = c.get('user')
  const dramaId = Number(c.req.param('id'))
  await getDramaOwned(dramaId, user)
  const body = await c.req.json()
  const chars = body.characters || []
  const ts = now()

  for (const char of chars) {
    if (char.id) {
      await db.update(schema.characters).set({ ...char, updatedAt: ts }).where(eq(schema.characters.id, char.id))
    } else {
      await db.insert(schema.characters).values({ ...char, dramaId, createdAt: ts, updatedAt: ts })
    }
  }
  return success(c)
})

// PUT /dramas/:id/episodes - Save episodes
app.put('/:id/episodes', async (c) => {
  const user = c.get('user')
  const dramaId = Number(c.req.param('id'))
  await getDramaOwned(dramaId, user)
  const body = await c.req.json()
  const episodes = body.episodes || []
  const ts = now()

  for (const ep of episodes) {
    if (ep.id) {
      await db.update(schema.episodes).set({ ...ep, updatedAt: ts }).where(eq(schema.episodes.id, ep.id))
    } else {
      await db.insert(schema.episodes).values({
        ...ep,
        dramaId,
        episodeNumber: ep.episode_number || ep.episodeNumber || 1,
        title: ep.title || '未命名',
        createdAt: ts,
        updatedAt: ts,
      })
    }
  }
  return success(c)
})

export default app
