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
 * 最终提示词补齐服务
 * 生图之前检查角色/场景/道具是否已有「最终提示词」，没有就驱动 prompt_generator
 * Agent 现场创作一幅并由其保存工具落库：
 * - 角色：三视图（character turnaround：正面/侧面/背面）
 * - 场景：固定视角，前景/中景/后景三段式
 * - 道具：白底单品静物（single product shot on pure white background）
 * 任何异常都吞掉并返回 ''，调用方据此回退到本地机械拼接的提示词
 */
import { eq } from 'drizzle-orm'
import type { MySqlColumn, MySqlTable } from 'drizzle-orm/mysql-core'
import { db, schema } from '../db/index.js'
import { mastra } from '../mastra/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { logTaskError, logTaskProgress } from '../utils/task-logger.js'

type CharacterRow = typeof schema.characters.$inferSelect
type SceneRow = typeof schema.scenes.$inferSelect
type PropRow = typeof schema.props.$inferSelect

/** 顶栏选择的文本模型/配置覆盖（不传则跟随 Agent 与文本配置默认） */
export interface PromptAgentOptions { model?: string; configId?: number }

/** 驱动 prompt_generator 完成一次创作会话 */
async function runPromptAgent(episodeId: number, dramaId: number, message: string, opts?: PromptAgentOptions) {
  const agent = mastra.getAgent('prompt_generator')
  if (!agent) throw new Error('图片提示词 Agent 不可用')
  await agent.generate([{ role: 'user', content: message }], {
    maxSteps: 12,
    requestContext: buildAgentRequestContext({
      episodeId,
      dramaId,
      modelOverride: opts?.model || undefined,
      textConfigId: opts?.configId || undefined,
    }),
  })
}

/** 三类资产的公共补齐流程：跑 Agent → 回读库里的 finalPrompt；出错记日志并返回 '' */
async function refreshViaAgent(
  table: MySqlTable,
  idColumn: MySqlColumn,
  finalPromptColumn: MySqlColumn,
  dramaId: number,
  episodeId: number,
  event: string,
  logMeta: Record<string, unknown>,
  message: string,
  opts?: PromptAgentOptions,
): Promise<string> {
  try {
    logTaskProgress('FinalPrompt', event, logMeta)
    await runPromptAgent(episodeId, dramaId, message, opts)
    const [fresh] = await db
      .select({ finalPrompt: finalPromptColumn })
      .from(table as any)
      .where(eq(idColumn, logMeta.id as number))
    return (fresh?.finalPrompt as string) || ''
  } catch (err: any) {
    logTaskError('FinalPrompt', event, { ...logMeta, error: err.message })
    return ''
  }
}

/** 确保角色拥有三视图最终提示词，返回最终提示词（失败返回 ''）；force 时忽略已有提示词强制重新生成 */
export async function ensureCharacterFinalPrompt(char: CharacterRow, episodeId: number, force = false, opts?: PromptAgentOptions): Promise<string> {
  if (char.finalPrompt && !force) return char.finalPrompt
  return refreshViaAgent(schema.characters, schema.characters.id, schema.characters.finalPrompt, char.dramaId, episodeId,
    'character-generate', { id: char.id, characterId: char.id, episodeId },
    `为角色「${char.name}」(character_id=${char.id}) 生成三视图最终提示词，并调用 save_character_final_prompt 保存。`, opts)
}

/** 确保场景拥有固定视角（前中后景）最终提示词，返回最终提示词（失败返回 ''）；force 时忽略已有提示词强制重新生成 */
export async function ensureSceneFinalPrompt(scene: SceneRow, episodeId: number, force = false, opts?: PromptAgentOptions): Promise<string> {
  if (scene.finalPrompt && !force) return scene.finalPrompt
  return refreshViaAgent(schema.scenes, schema.scenes.id, schema.scenes.finalPrompt, scene.dramaId, episodeId,
    'scene-generate', { id: scene.id, sceneId: scene.id, episodeId },
    `为场景「${scene.location}」(scene_id=${scene.id}) 生成固定视角（前景/中景/后景）最终提示词，并调用 save_scene_final_prompt 保存。`, opts)
}

/** 确保道具拥有白底单品最终提示词，返回最终提示词（失败返回 ''）；force 时忽略已有提示词强制重新生成 */
export async function ensurePropFinalPrompt(prop: PropRow, episodeId: number, force = false, opts?: PromptAgentOptions): Promise<string> {
  if (prop.finalPrompt && !force) return prop.finalPrompt
  return refreshViaAgent(schema.props, schema.props.id, schema.props.finalPrompt, prop.dramaId, episodeId,
    'prop-generate', { id: prop.id, propId: prop.id, episodeId },
    `为道具「${prop.name}」(prop_id=${prop.id}) 生成白底单品最终提示词，并调用 save_prop_final_prompt 保存。`, opts)
}
