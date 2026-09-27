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
 * 生产编排路由 — 按集顺序自动化生产的启动/暂停/继续/状态
 */
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound } from '../utils/response.js'
import { startProduction, pauseProduction, resumeProduction, getProductionStatus, PRODUCTION_STEPS } from '../services/production.js'
import { getDramaOwned, OwnershipError } from '../services/ownership.js'
import { aiCallGuard } from '../services/ai-switch.js'

const app = new Hono()

/** 归属校验：项目不存在或非当前用户一律 404 */
async function requireDrama(c: any): Promise<number | null> {
  const dramaId = Number(c.req.param('id'))
  if (!dramaId) return null
  try {
    await getDramaOwned(dramaId, c.get('user'))
  } catch (err) {
    if (err instanceof OwnershipError) return null
    throw err
  }
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama || drama.deletedAt) return null
  return dramaId
}

// POST /production/dramas/:id/start — 启动自动生产（from_episode_number 缺省 = 第一个未完成集）
app.post('/dramas/:id/start', async (c) => {
  const blocked = aiCallGuard(c)
  if (blocked) return blocked
  const dramaId = await requireDrama(c)
  if (!dramaId) return notFound(c, '剧集不存在')
  const body = await c.req.json().catch(() => ({}))
  const fromEpisodeNumber = Number(body.from_episode_number) || undefined
  const result = startProduction(dramaId, fromEpisodeNumber)
  if (!result.started) return success(c, { status: 'running', already_running: true })
  return success(c, { status: 'running', started: true, steps: PRODUCTION_STEPS })
})

// POST /production/dramas/:id/pause — 暂停（不中断正在跑的上游任务）
app.post('/dramas/:id/pause', async (c) => {
  const dramaId = await requireDrama(c)
  if (!dramaId) return notFound(c, '剧集不存在')
  const paused = pauseProduction(dramaId)
  if (!paused) return badRequest(c, '当前没有正在运行的生产任务')
  return success(c, { status: 'paused' })
})

// POST /production/dramas/:id/resume — 继续/失败重试（paused/error/重启丢失 run 均可，按 DB 状态推导剩余步骤）
app.post('/dramas/:id/resume', async (c) => {
  const blocked = aiCallGuard(c)
  if (blocked) return blocked
  const dramaId = await requireDrama(c)
  if (!dramaId) return notFound(c, '剧集不存在')
  const resumed = await resumeProduction(dramaId)
  if (!resumed) return badRequest(c, '当前没有可继续的生产任务')
  return success(c, { status: 'running', resumed: true })
})

// GET /production/dramas/:id/status — run 状态 + 每集步骤概要
app.get('/dramas/:id/status', async (c) => {
  const dramaId = await requireDrama(c)
  if (!dramaId) return notFound(c, '剧集不存在')
  return success(c, await getProductionStatus(dramaId))
})

export default app
