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
 * 「提示词生成」Agent 工具集：三类资产各一对读/存工具。
 *
 * 创作完全交给 Agent（规范见 workspace/skills/prompt-generator 下的 SKILL.md：
 * 角色三视图 / 场景固定视角 / 道具白底单品）；工具只做两件事——
 * 把资产档案喂给它、把它写好的提示词拼接项目视觉风格后落库。
 * dramaId 经 RequestContext 按请求注入，工具本身是模块级单例。
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { db, schema } from '../../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../../utils/response.js'
import { getDramaStylePrompt } from '../../services/style-preset.js'
import { getDramaId } from '../context.js'

/** 过滤软删除行 */
const alive = <T extends { deletedAt: unknown }>(rows: T[]) => rows.filter(r => !r.deletedAt)

/**
 * 保存最终提示词的公共落库步骤：取项目视觉风格、前置拼接、写回对应表。
 * prompt 参数是 Agent 创作的纯描述文本，风格词由这里统一注入。
 */
async function persistFinalPrompt(table: any, assetId: number, dramaId: number, prompt: string) {
  const stylePrompt = await getDramaStylePrompt(dramaId)
  const finalPrompt = stylePrompt ? `${stylePrompt}, ${prompt}` : prompt
  await db.update(table)
    .set({ finalPrompt, updatedAt: now() })
    .where(eq(table.id, assetId))
  return finalPrompt
}

// ─── 角色 ─────────────────────────────────────────────

const readCharacters = createTool({
  id: 'read_characters',
  description: '列出本剧全部角色档案（样貌/妆造/背景/既有最终提示词），供创作角色三视图最终提示词。',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const dramaId = getDramaId(context?.requestContext)
    if (!dramaId) return { error: 'Missing dramaId in request context' }
    const rows = alive(await db.select().from(schema.characters).where(eq(schema.characters.dramaId, dramaId)))
    return {
      characters: rows.map(c => ({
        id: c.id,
        name: c.name,
        role: c.role || '',
        description: c.description || '',
        appearance: c.appearance || '',
        styling: c.styling || '',
        final_prompt: c.finalPrompt || '',
      })),
    }
  },
})

const saveCharacterFinalPrompt = createTool({
  id: 'save_character_final_prompt',
  description: '落库角色三视图最终提示词。prompt 只写纯描述（中文、无风格词），项目视觉风格由本工具自动前置拼接。',
  inputSchema: z.object({
    character_id: z.number(),
    prompt: z.string().describe('角色三视图最终提示词（纯中文，不含风格词）'),
  }),
  execute: async ({ character_id, prompt }, context) => {
    const dramaId = getDramaId(context?.requestContext)
    if (!dramaId) return { error: 'Missing dramaId in request context' }
    const [row] = await db.select({ id: schema.characters.id, name: schema.characters.name })
      .from(schema.characters).where(eq(schema.characters.id, character_id))
    if (!row) return { error: 'Character not found' }

    const finalPrompt = await persistFinalPrompt(schema.characters, character_id, dramaId, prompt)
    return { character_id: row.id, character_name: row.name, saved: true, final_prompt: finalPrompt }
  },
})

// ─── 场景 ─────────────────────────────────────────────

const readScenes = createTool({
  id: 'read_scenes',
  description: '列出本剧全部场景档案（地点/时段/描述/光影/既有最终提示词），供创作场景固定视角最终提示词。',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const dramaId = getDramaId(context?.requestContext)
    if (!dramaId) return { error: 'Missing dramaId in request context' }
    const rows = alive(await db.select().from(schema.scenes).where(eq(schema.scenes.dramaId, dramaId)))
    return {
      scenes: rows.map(s => ({
        id: s.id,
        location: s.location,
        time: s.time || '',
        prompt: s.prompt || '',
        lighting: s.lighting || '',
        final_prompt: s.finalPrompt || '',
      })),
    }
  },
})

const saveSceneFinalPrompt = createTool({
  id: 'save_scene_final_prompt',
  description: '落库场景固定视角（前/中/后景分层）最终提示词。prompt 只写纯描述（中文、无风格词），项目视觉风格由本工具自动前置拼接。',
  inputSchema: z.object({
    scene_id: z.number(),
    prompt: z.string().describe('场景固定视角最终提示词（纯中文，不含风格词）'),
  }),
  execute: async ({ scene_id, prompt }, context) => {
    const dramaId = getDramaId(context?.requestContext)
    if (!dramaId) return { error: 'Missing dramaId in request context' }
    const [row] = await db.select({ id: schema.scenes.id, location: schema.scenes.location })
      .from(schema.scenes).where(eq(schema.scenes.id, scene_id))
    if (!row) return { error: 'Scene not found' }

    const finalPrompt = await persistFinalPrompt(schema.scenes, scene_id, dramaId, prompt)
    return { scene_id: row.id, location: row.location, saved: true, final_prompt: finalPrompt }
  },
})

// ─── 道具 ─────────────────────────────────────────────

const readProps = createTool({
  id: 'read_props',
  description: '列出本项目全部道具档案（名称/类型/外观/既有最终提示词），供创作道具白底单品最终提示词。',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const dramaId = getDramaId(context?.requestContext)
    if (!dramaId) return { error: 'Missing dramaId in request context' }
    const rows = alive(await db.select().from(schema.props).where(eq(schema.props.dramaId, dramaId)))
    return {
      props: rows.map(p => ({
        id: p.id,
        name: p.name,
        type: p.type || '',
        description: p.description || '',
        final_prompt: p.finalPrompt || '',
      })),
    }
  },
})

const savePropFinalPrompt = createTool({
  id: 'save_prop_final_prompt',
  description: '落库道具白底单品最终提示词。prompt 只写纯描述（中文、无风格词），项目视觉风格由本工具自动前置拼接。',
  inputSchema: z.object({
    prop_id: z.number(),
    prompt: z.string().describe('道具白底单品最终提示词（纯中文，不含风格词）'),
  }),
  execute: async ({ prop_id, prompt }, context) => {
    const dramaId = getDramaId(context?.requestContext)
    if (!dramaId) return { error: 'Missing dramaId in request context' }
    const [row] = await db.select({ id: schema.props.id, name: schema.props.name })
      .from(schema.props).where(eq(schema.props.id, prop_id))
    if (!row) return { error: 'Prop not found' }

    const finalPrompt = await persistFinalPrompt(schema.props, prop_id, dramaId, prompt)
    return { prop_id: row.id, prop_name: row.name, saved: true, final_prompt: finalPrompt }
  },
})

export const imagePromptTools = {
  readCharacters,
  saveCharacterFinalPrompt,
  readScenes,
  saveSceneFinalPrompt,
  readProps,
  savePropFinalPrompt,
}
