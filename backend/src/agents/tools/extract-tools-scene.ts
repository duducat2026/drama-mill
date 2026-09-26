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
 * 提取 Agent — 场景 read/save 工具（按 location+time 去重）
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { db, getInsertId, schema } from '../../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../../utils/response.js'
import { logTaskProgress, logTaskSuccess } from '../../utils/task-logger.js'
import {
  linkSceneToEpisode,
  normalizeLocation,
  requireIds,
  type ToolContext,
} from './extract-tools-shared.js'

// 3. 读取项目中已存在的场景（用于去重判断）
export const readExistingScenes = createTool({
  id: 'read_existing_scenes',
  description: 'Read all scenes already existing in this drama project (for deduplication).',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const links = await db.select().from(schema.episodeScenes)
      .where(eq(schema.episodeScenes.episodeId, episodeId))
    const linkedIds = new Set(links.map(link => link.sceneId))
    const scenes = (await db.select().from(schema.scenes)
      .where(eq(schema.scenes.dramaId, dramaId)))
      .filter(s => !s.deletedAt)
    const visibleScenes = scenes.map(s => ({
      id: s.id,
      location: s.location,
      time: s.time || '',
      prompt: s.prompt || '',
      lighting: s.lighting || '',
      normalized_location: normalizeLocation(s.location), // 用于判断近名复用（仅空白/大小写）
    }))
    const payload = {
      count: visibleScenes.length,
      scenes: visibleScenes,
      current_episode_scenes: visibleScenes.filter(s => linkedIds.has(s.id)),
    }
    logTaskSuccess('ExtractTool', 'read-scenes', {
      episodeId,
      dramaId,
      projectScenes: payload.count,
      episodeScenes: payload.current_episode_scenes.length,
    })
    return payload
  },
})

// 5. 智能保存场景（按地点+时间段去重，与现有数据合并）
export const saveDedupScenes = createTool({
  id: 'save_dedup_scenes',
  description: 'Save extracted scenes with deduplication. Existing scenes (same location+time) are reused; new ones are created. All are linked to the current episode.',
  inputSchema: z.object({
    scenes: z.array(z.object({
      location: z.string(),
      time: z.string().optional(),
      prompt: z.string().optional(),
      description: z.string().optional(),
      lighting: z.string().optional(),
    })),
  }),
  execute: async ({ scenes }, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const ts = now()
    const results = { created: 0, reused: 0 }
    logTaskProgress('ExtractTool', 'save-scenes-begin', {
      episodeId,
      dramaId,
      scenes: scenes.map(scene => `${scene.location}@${scene.time || ''}`).join(','),
    })

    for (const scene of scenes) {
      // 按地点+时间段精确匹配；地点仅做空白/大小写归一化（不删括号，避免误合并）
      const scenesInProject = (await db.select().from(schema.scenes)
        .where(eq(schema.scenes.dramaId, dramaId)))
        .filter(s => !s.deletedAt)
      const normLocation = normalizeLocation(scene.location)
      const existing = scenesInProject.find(s => s.location === scene.location && s.time === (scene.time || ''))
        || (normLocation ? scenesInProject.find(s => normalizeLocation(s.location) === normLocation && s.time === (scene.time || '')) : undefined)

      if (existing) {
        // 已存在完全匹配的场景：关联并补齐描述/光影
        await db.update(schema.scenes).set({
          prompt: scene.prompt || scene.description || existing.prompt,
          lighting: scene.lighting || existing.lighting,
          updatedAt: ts,
        }).where(eq(schema.scenes.id, existing.id))
        await linkSceneToEpisode(episodeId, existing.id)
        results.reused++
      } else {
        const res = await db.insert(schema.scenes).values({
          dramaId,
          location: scene.location,
          time: scene.time || '',
          prompt: scene.prompt || scene.description || scene.location,
          lighting: scene.lighting || '',
          createdAt: ts,
          updatedAt: ts,
        })
        const sceneId = getInsertId(res)
        await linkSceneToEpisode(episodeId, sceneId)
        results.created++
      }
    }

    const payload = {
      message: `场景保存完成：新增 ${results.created}，复用已有 ${results.reused}`,
      ...results,
    }
    logTaskSuccess('ExtractTool', 'save-scenes-complete', { episodeId, ...results })
    return payload
  },
})
