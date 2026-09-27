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
 * 完成计费用小工具（拆分自 generation.ts）：任务用量记录与图片资产回写。
 */
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../utils/response.js'
import { recordImageUsage, recordVideoUsage } from './cost.js'
import { isConfigTestParams, parseTaskParams } from './generation.js'
import type { SysTaskRecord } from './generation.js'

/** 成本归属：任务行解析所属剧集（分镜关联优先），无关联返回 null */
export async function resolveTaskEpisodeId(record: SysTaskRecord): Promise<number | null> {
  if (!record.storyboardId) return null
  const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, record.storyboardId))
  return sb?.episodeId ?? null
}

/** 任务完成时记录用量（图片计 1 张；视频按请求时长秒数计价） */
export async function recordTaskUsage(record: SysTaskRecord) {
  const params = parseTaskParams(record.params)
  const episodeId = await resolveTaskEpisodeId(record)
  const ctx = {
    userId: record.userId ?? null,
    dramaId: record.dramaId ?? null,
    episodeId,
    configId: params.configId ?? null,
    detail: isConfigTestParams(params) ? `生成测试 task#${record.id}` : `task#${record.id}`,
  }
  if (record.type === 'image') {
    await recordImageUsage(record.provider || '', record.model || '', ctx)
  } else {
    await recordVideoUsage(record.provider || '', record.model || '', Number(params.duration) || 5, ctx)
  }
}

