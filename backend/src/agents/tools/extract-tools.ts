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
 * 角色/场景/道具 提取 Agent 工具门面。
 * 单 Agent 一步流程：读剧本 → 读已有角色/场景/道具（去重） → 智能合并保存。
 * 具体工具按实体拆到 extract-tools-{character|scene|prop}.ts；公共 helper 在 shared。
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { db, schema } from '../../db/index.js'
import { eq } from 'drizzle-orm'
import { logTaskSuccess } from '../../utils/task-logger.js'
import { requireIds } from './extract-tools-shared.js'
import { readExistingCharacters, saveDedupCharacters } from './extract-tools-character.js'
import { readExistingScenes, saveDedupScenes } from './extract-tools-scene.js'
import { readExistingProps, saveDedupProps } from './extract-tools-prop.js'

// 1. 读取剧本内容
const readScriptForExtraction = createTool({
  id: 'read_script_for_extraction',
  description: 'Read the formatted screenplay for character/scene extraction.',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const [ep] = await db.select().from(schema.episodes)
      .where(eq(schema.episodes.id, episodeId))
    if (!ep) return { error: 'Episode not found' }
    const content = ep.scriptContent || ep.content
    if (!content) return { error: 'Episode has no script content' }
    logTaskSuccess('ExtractTool', 'read-script', { episodeId, dramaId, scriptLength: content.length })
    return { script: content }
  },
})

export {
  readExistingCharacters,
  saveDedupCharacters,
  readExistingScenes,
  saveDedupScenes,
  readExistingProps,
  saveDedupProps,
}

export const extractTools = {
  readScriptForExtraction,
  readExistingCharacters,
  readExistingScenes,
  saveDedupCharacters,
  saveDedupScenes,
  readExistingProps,
  saveDedupProps,
}
