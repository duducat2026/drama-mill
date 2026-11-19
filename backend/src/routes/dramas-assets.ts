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
 * 项目素材子路由（挂载于 /dramas）— 素材图片状态 + 角色/剧集批量保存
 * 路径按注册顺序生效：/:id/assets-status 先于门面 dramas.ts 的 /:id 通配路由
 */
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
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

// 批量保存可写字段白名单：请求体里的 id / dramaId / deletedAt 等一律不接，
// 否则一次 PUT 就能改他人行或伪造归属
const CHAR_FIELDS = ['name', 'description', 'role', 'appearance', 'styling', 'imageUrl', 'finalPrompt'] as const
const EP_FIELDS = ['title', 'episodeNumber', 'content', 'scriptContent', 'imageConfigId', 'videoConfigId', 'resolution', 'status'] as const

/** 按白名单取字段（camel 优先、snake 兜底），只返回显式传入的项 */
function pickFields(src: any, fields: readonly string[]) {
  const out: Record<string, any> = {}
  for (const f of fields) {
    const snake = f.replace(/[A-Z]/g, m => '_' + m.toLowerCase())
    const v = src[f] !== undefined ? src[f] : src[snake]
    if (v !== undefined) out[f] = v
  }
  return out
}

// PUT /dramas/:id/characters - Save characters
app.put('/:id/characters', async (c) => {
  const user = c.get('user')
  const dramaId = Number(c.req.param('id'))
  await getDramaOwned(dramaId, user)
  const body = await c.req.json()
  const chars = body.characters || []
  const ts = now()

  for (const char of chars) {
    const updates = pickFields(char, CHAR_FIELDS)
    if (char.id) {
      // 更新必须同时约束 id 与 dramaId：只按 id 改会越权改写到他人项目
      await db.update(schema.characters).set({ ...updates, updatedAt: ts })
        .where(and(eq(schema.characters.id, char.id), eq(schema.characters.dramaId, dramaId)))
    } else {
      await db.insert(schema.characters).values({ ...updates, name: updates.name ?? '', dramaId, createdAt: ts, updatedAt: ts })
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
    const values = pickFields(ep, EP_FIELDS)
    if (ep.id) {
      await db.update(schema.episodes).set({ ...values, updatedAt: ts })
        .where(and(eq(schema.episodes.id, ep.id), eq(schema.episodes.dramaId, dramaId)))
    } else {
      await db.insert(schema.episodes).values({
        ...values,
        dramaId,
        episodeNumber: values.episodeNumber || 1,
        title: values.title || '未命名',
        createdAt: ts,
        updatedAt: ts,
      })
    }
  }
  return success(c)
})

export default app
