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
 * 提取 Agent — 角色 read/save 工具（按 name 去重，与已有数据合并）
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { db, getInsertId, schema } from '../../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../../utils/response.js'
import { logTaskProgress, logTaskSuccess } from '../../utils/task-logger.js'
import {
  linkCharToEpisode,
  normalizeName,
  requireIds,
  type ToolContext,
} from './extract-tools-shared.js'

// 2. 读取项目中已存在的角色（用于去重判断）
export const readExistingCharacters = createTool({
  id: 'read_existing_characters',
  description: 'Read all characters already existing in this drama project (for deduplication).',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const links = await db.select().from(schema.episodeCharacters)
      .where(eq(schema.episodeCharacters.episodeId, episodeId))
    const linkedIds = new Set(links.map(link => link.characterId))
    const chars = (await db.select().from(schema.characters)
      .where(eq(schema.characters.dramaId, dramaId)))
      .filter(c => !c.deletedAt)
    const visibleChars = chars.map(c => ({
      id: c.id,
      name: c.name,
      role: c.role || '',
      appearance: c.appearance || '',
      styling: c.styling || '',
      normalized_name: normalizeName(c.name), // 用于判断近名复用：括号定位/别名视为同名
    }))
    const payload = {
      count: visibleChars.length,
      characters: visibleChars,
      current_episode_characters: visibleChars.filter(c => linkedIds.has(c.id)),
    }
    logTaskSuccess('ExtractTool', 'read-characters', {
      episodeId,
      dramaId,
      projectCharacters: payload.count,
      episodeCharacters: payload.current_episode_characters.length,
    })
    return payload
  },
})

// 4. 智能保存角色（按名字去重，与现有数据合并）
export const saveDedupCharacters = createTool({
  id: 'save_dedup_characters',
  description: 'Save extracted characters with deduplication. Existing characters (same name) are merged/updated; new ones are created. All are linked to the current episode.',
  inputSchema: z.object({
    characters: z.array(z.object({
      name: z.string(),
      role: z.string().optional(),
      description: z.string().optional(),
      appearance: z.string().optional(),
      styling: z.string().optional(),
    })),
  }),
  execute: async ({ characters }, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const ts = now()
    const results = { created: 0, merged: 0 }
    logTaskProgress('ExtractTool', 'save-characters-begin', {
      episodeId,
      dramaId,
      names: characters.map(char => char.name).join(','),
    })

    for (const char of characters) {
      const charsInProject = (await db.select().from(schema.characters)
        .where(eq(schema.characters.dramaId, dramaId)))
        .filter(c => !c.deletedAt)
      const exact = charsInProject.find(c => c.name === char.name)
      const normName = normalizeName(char.name)
      const existing = exact || (normName ? charsInProject.find(c => c.name && normalizeName(c.name) === normName) : undefined)
      const matchedViaNorm = !!existing && existing !== exact

      if (existing) {
        // 归一化命中：括号定位/别名等近名视作同一角色复用，避免重复创建
        if (matchedViaNorm) logTaskProgress('ExtractTool', 'save-characters-reuse', { episodeId, dramaId, extracted: char.name, reused: existing.name })
        // 已存在：合并信息，保留 ID
        await db.update(schema.characters).set({
          role: char.role || existing.role,
          description: char.description || existing.description,
          appearance: char.appearance || existing.appearance,
          styling: char.styling || char.description || existing.styling,
          updatedAt: ts,
        }).where(eq(schema.characters.id, existing.id))
        await linkCharToEpisode(episodeId, existing.id)
        results.merged++
      } else {
        // 新增角色
        const res = await db.insert(schema.characters).values({
          name: char.name,
          role: char.role || '',
          description: char.description || '',
          appearance: char.appearance || '',
          styling: char.styling || char.description || '',
          dramaId,
          createdAt: ts,
          updatedAt: ts,
        })
        const charId = getInsertId(res)
        await linkCharToEpisode(episodeId, charId)
        results.created++
      }
    }

    const payload = {
      message: `角色保存完成：新增 ${results.created}，合并更新 ${results.merged}`,
      ...results,
    }
    logTaskSuccess('ExtractTool', 'save-characters-complete', { episodeId, ...results })
    return payload
  },
})
