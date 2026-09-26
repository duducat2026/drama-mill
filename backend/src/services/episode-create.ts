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
 * 建集共享逻辑 — POST /episodes 路由与小说自动拆分共用
 * 创建集时锁定图片/视频生成配置（显式传入优先，缺省取当前启用的最高优先级官方配置）
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { getActiveConfigId } from './ai.js'

export interface CreateEpisodeOpts {
  title?: string
  resolution?: string
  imageConfigId?: number | null
  videoConfigId?: number | null
  content?: string
  description?: string
}

export interface CreatedEpisode {
  id: number
  episode_number: number
  title: string
  image_config_id: number | null
  video_config_id: number | null
  resolution: string
}

export async function createEpisode(dramaId: number, opts: CreateEpisodeOpts = {}, userId?: number): Promise<CreatedEpisode> {
  // 建集锁定配置只在该用户启用的配置中选（userId 缺省退回全量，兼容历史链路）
  const imageConfigId = opts.imageConfigId ?? await getActiveConfigId('image', userId)
  const videoConfigId = opts.videoConfigId ?? await getActiveConfigId('video', userId)
  if (!imageConfigId) throw new Error('未找到启用的图片生成配置，请先在设置中心添加')
  if (!videoConfigId) throw new Error('未找到启用的视频生成配置，请先在设置中心添加')
  const ts = now()

  // Get next episode number（忽略已软删的集，删除中间集后新集号可复用空位之后的最大值）
  const existing = await db.select().from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, dramaId), isNull(schema.episodes.deletedAt)))
    .orderBy(schema.episodes.episodeNumber)
  const nextNum = existing.length ? Math.max(...existing.map(e => e.episodeNumber)) + 1 : 1

  const res = await db.insert(schema.episodes).values({
    dramaId,
    episodeNumber: nextNum,
    title: opts.title || `第${nextNum}集`,
    content: opts.content ?? null,
    description: opts.description ?? null,
    imageConfigId,
    videoConfigId,
    // 视频分辨率在创建集时固定（480p/720p），后续可通过 PUT 修改
    resolution: opts.resolution === '480p' ? '480p' : '720p',
    createdAt: ts,
    updatedAt: ts,
  })

  const [ep] = await db.select().from(schema.episodes)
    .where(eq(schema.episodes.id, getInsertId(res)))
  return {
    id: ep.id,
    episode_number: ep.episodeNumber,
    title: ep.title,
    image_config_id: ep.imageConfigId,
    video_config_id: ep.videoConfigId,
    resolution: ep.resolution || '720p',
  }
}
