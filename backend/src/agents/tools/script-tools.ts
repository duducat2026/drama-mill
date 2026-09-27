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
 * 「剧本改写」Agent 的三个工具：读本集原文 / 取原文并附改写要求 / 回写剧本。
 * 工具对象是模块级单例，本集归属靠 RequestContext 按请求携带。
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { db, schema } from '../../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../../utils/response.js'
import { getEpisodeId } from '../context.js'

/** 取本集行，取不到时返回错误文案 */
async function loadEpisode(episodeId: number) {
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  return ep || null
}

const readEpisodeScript = createTool({
  id: 'read_episode_script',
  description: 'Fetch the raw text stored on the current episode (content column, falling back to script).',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const episodeId = getEpisodeId(context?.requestContext)
    if (!episodeId) return { error: 'Missing episodeId in request context' }
    const ep = await loadEpisode(episodeId)
    if (!ep) return { error: `Episode not found (id=${episodeId})` }
    const text = ep.content || ep.scriptContent
    if (!text) return { error: `Episode has no content (id=${episodeId})` }
    return { content: text, word_count: text.length, episode_id: episodeId }
  },
})

/** 交给 Agent 的排版规约：场景头/对白行格式是分镜解析的读取契约，不可改动 */
const SCREENPLAY_SPEC = `把下面的原文改写成格式化剧本，遵守排版规约：
- 场景头行固定为：## S编号 | 内景/外景 · 地点 | 时间段
- 动作叙述用自然段，正文严禁出现镜头语言（景别/机位/运镜）
- 每一句对白写成：角色名：（状态/表情）台词内容
- 单场戏体量控制在 30-60 秒
`

const rewriteToScreenplay = createTool({
  id: 'rewrite_to_screenplay',
  description: 'Pull the episode source text together with the screenplay formatting spec for you to rewrite.',
  inputSchema: z.object({
    instructions: z.string().optional().describe('Extra rewriting requirements from the user'),
  }),
  execute: async ({ instructions }, context) => {
    const episodeId = getEpisodeId(context?.requestContext)
    if (!episodeId) return { error: 'Missing episodeId in request context' }
    const ep = await loadEpisode(episodeId)
    if (!ep) return { error: 'Episode not found' }
    const source = ep.content || ep.scriptContent
    if (!source) return { error: 'Episode has no content to rewrite' }

    return {
      source_content: source,
      instruction: `${SCREENPLAY_SPEC}\n${instructions || ''}\n【原文开始】\n${source}`,
    }
  },
})

const saveScript = createTool({
  id: 'save_script',
  description: 'Write the finished screenplay back onto the current episode.',
  inputSchema: z.object({
    content: z.string().describe('Formatted screenplay text to persist'),
  }),
  execute: async ({ content }, context) => {
    const episodeId = getEpisodeId(context?.requestContext)
    if (!episodeId) return { error: 'Missing episodeId in request context' }
    await db.update(schema.episodes)
      .set({ scriptContent: content, updatedAt: now() })
      .where(eq(schema.episodes.id, episodeId))

    return { message: 'Script saved', word_count: content.length }
  },
})

export const scriptTools = { readEpisodeScript, rewriteToScreenplay, saveScript }
