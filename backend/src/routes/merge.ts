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
import fs from 'node:fs'
import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound, now } from '../utils/response.js'
import { mergeEpisodeVideos } from '../services/ffmpeg-merge.js'
import { toSnakeCase } from '../utils/transform.js'
import { getAbsolutePath, localFileSize } from '../utils/storage.js'
import { posterPathFor } from '../utils/video-poster.js'
import { getEpisodeOwned } from '../services/ownership.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

// POST /episodes/:id/merge — 拼接镜头视频(body.storyboard_ids 可选,只拼所选)
app.post('/episodes/:id/merge', async (c) => {
  const user = c.get('user')
  const episodeId = Number(c.req.param('id'))
  const { ep } = await getEpisodeOwned(episodeId, user)

  let storyboardIds: number[] | undefined
  try {
    const body = await c.req.json()
    if (Array.isArray(body?.storyboard_ids)) {
      storyboardIds = body.storyboard_ids.map(Number).filter(Boolean)
    }
  } catch { /* 无 body 时拼接全部 */ }

  try {
    logTaskStart('MergeAPI', 'episode-merge', { episodeId, dramaId: ep.dramaId, storyboardIds })
    const mergeId = await mergeEpisodeVideos(episodeId, ep.dramaId, storyboardIds, user.id)
    logTaskSuccess('MergeAPI', 'episode-merge', { episodeId, mergeId })
    return success(c, { merge_id: mergeId, status: 'processing' })
  } catch (err: any) {
    logTaskError('MergeAPI', 'episode-merge', { episodeId, error: err.message })
    return badRequest(c, err.message)
  }
})

// GET /episodes/:id/merge — 查询最新拼接状态（已删除的成片不再返回）
app.get('/episodes/:id/merge', async (c) => {
  const user = c.get('user')
  const episodeId = Number(c.req.param('id'))
  await getEpisodeOwned(episodeId, user)
  const merges = await db.select().from(schema.videoMerges)
    .where(and(eq(schema.videoMerges.episodeId, episodeId), isNull(schema.videoMerges.deletedAt)))


  const latest = merges[merges.length - 1]
  if (!latest) return success(c, null)

  return success(c, { ...toSnakeCase(latest), merged_size: localFileSize(latest.mergedUrl) })
})

// GET /episodes/:id/merges — 成片列表(全部拼接记录,新的在前)
app.get('/episodes/:id/merges', async (c) => {
  const user = c.get('user')
  const episodeId = Number(c.req.param('id'))
  await getEpisodeOwned(episodeId, user)
  const merges = await db.select().from(schema.videoMerges)
    .where(and(eq(schema.videoMerges.episodeId, episodeId), isNull(schema.videoMerges.deletedAt)))
  merges.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  return success(c, merges.slice(0, 30).map(m => ({ ...toSnakeCase(m), merged_size: localFileSize(m.mergedUrl) })))
})

// DELETE /episodes/:id/merges/:mergeId — 删除成片（软删记录 + 物理移除成片与海报帧，释放磁盘）
app.delete('/episodes/:id/merges/:mergeId', async (c) => {
  const user = c.get('user')
  const episodeId = Number(c.req.param('id'))
  const mergeId = Number(c.req.param('mergeId'))
  const { ep } = await getEpisodeOwned(episodeId, user)

  const [merge] = await db.select().from(schema.videoMerges)
    .where(and(eq(schema.videoMerges.id, mergeId), isNull(schema.videoMerges.deletedAt)))
  if (!merge || merge.episodeId !== episodeId) return notFound(c, '成片不存在')
  if (merge.status === 'pending' || merge.status === 'processing') {
    return badRequest(c, '拼接进行中，请完成后再删除')
  }

  logTaskStart('MergeAPI', 'delete-merge', { mergeId, episodeId })
  await db.update(schema.videoMerges).set({ deletedAt: now() })
    .where(eq(schema.videoMerges.id, mergeId))

  // 当前集播放地址指向被删成片时解除引用，避免前端拿到 404 地址
  if (merge.mergedUrl && ep.videoUrl === merge.mergedUrl) {
    await db.update(schema.episodes).set({ videoUrl: null, updatedAt: now() })
      .where(eq(schema.episodes.id, episodeId))
  }

  // 物理删除成片与海报帧（成片体积大，及时回收磁盘；文件缺失静默跳过）
  if (merge.mergedUrl) {
    for (const rel of [merge.mergedUrl, posterPathFor(merge.mergedUrl)]) {
      try { fs.unlinkSync(getAbsolutePath(rel)) } catch { /* 文件可能已不存在 */ }
    }
  }
  logTaskSuccess('MergeAPI', 'delete-merge', { mergeId, episodeId })
  return success(c)
})

export default app
