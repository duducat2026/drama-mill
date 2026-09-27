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
 * 分镜 Agent 工具共享层：db 绑定同步 / 归属校验 / 宽容输入类型 & zod 字段。
 */
import type { ToolExecutionContext } from '@mastra/core/tools'
import { z } from 'zod'
import { db, schema } from '../../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../../utils/response.js'
import { getDramaId, getEpisodeId } from '../context.js'

export async function syncStoryboardCharacters(storyboardId: number, characterIds: number[]) {
  await db.delete(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))


  const uniqueIds = [...new Set(characterIds.filter(Boolean))]
  if (!uniqueIds.length) return

  for (const characterId of uniqueIds) {
    await db.insert(schema.storyboardCharacters).values({
      storyboardId,
      characterId,
    })
  }
}

export async function syncStoryboardProps(storyboardId: number, propIds: number[]) {
  await db.delete(schema.storyboardProps)
    .where(eq(schema.storyboardProps.storyboardId, storyboardId))

  const uniqueIds = [...new Set(propIds.filter(Boolean))]
  if (!uniqueIds.length) return

  for (const propId of uniqueIds) {
    await db.insert(schema.storyboardProps).values({
      storyboardId,
      propId,
    })
  }
}

async function getEpisodeSceneIds(episodeId: number) {
  const links = await db.select().from(schema.episodeScenes)
    .where(eq(schema.episodeScenes.episodeId, episodeId))
  return new Set(links.map(link => link.sceneId))
}

async function getEpisodeCharacterIds(episodeId: number) {
  const links = await db.select().from(schema.episodeCharacters)
    .where(eq(schema.episodeCharacters.episodeId, episodeId))
  return new Set(links.map(link => link.characterId))
}

async function getEpisodePropIds(episodeId: number) {
  const links = await db.select().from(schema.episodeProps)
    .where(eq(schema.episodeProps.episodeId, episodeId))
  return new Set(links.map(link => link.propId))
}

export async function validateStoryboardBindings(episodeId: number, dramaId: number, sceneId: number | null | undefined, characterIds: number[] | undefined, propIds?: number[] | undefined) {
  const episodeSceneIds = await getEpisodeSceneIds(episodeId)
  const episodeCharacterIds = await getEpisodeCharacterIds(episodeId)
  const episodePropIds = await getEpisodePropIds(episodeId)

  // 场景/角色/道具属于本剧但尚未关联到当前集时，自动补关联（拆分时即完成绑定）
  if (sceneId != null && !episodeSceneIds.has(sceneId)) {
    const [scene] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId))
    if (!scene || scene.dramaId !== dramaId || scene.deletedAt) {
      throw new Error(`scene_id ${sceneId} 不属于当前项目`)
    }
    await db.insert(schema.episodeScenes).values({ episodeId, sceneId, createdAt: now() })
  }

  const uniqueCharacterIds = [...new Set((characterIds || []).filter(Boolean))]
  for (const characterId of uniqueCharacterIds) {
    if (episodeCharacterIds.has(characterId)) continue
    const [character] = await db.select().from(schema.characters).where(eq(schema.characters.id, characterId))
    if (!character || character.dramaId !== dramaId || character.deletedAt) {
      throw new Error(`character_id ${characterId} 不属于当前项目`)
    }
    await db.insert(schema.episodeCharacters).values({ episodeId, characterId, createdAt: now() })
  }

  const uniquePropIds = [...new Set((propIds || []).filter(Boolean))]
  for (const propId of uniquePropIds) {
    if (episodePropIds.has(propId)) continue
    const [prop] = await db.select().from(schema.props).where(eq(schema.props.id, propId))
    if (!prop || prop.dramaId !== dramaId || prop.deletedAt) {
      throw new Error(`prop_id ${propId} 不属于当前项目`)
    }
    await db.insert(schema.episodeProps).values({ episodeId, propId, createdAt: now() })
  }
}

export type ToolContext = ToolExecutionContext | undefined

export function requireIds(context: ToolContext): { episodeId: number; dramaId: number } | { error: string } {
  const episodeId = getEpisodeId(context?.requestContext)
  const dramaId = getDramaId(context?.requestContext)
  if (!episodeId || !dramaId) return { error: 'Missing episodeId/dramaId in request context' }
  return { episodeId, dramaId }
}

// ─── 宽容输入转换：推理模型（如 qwen3.8-max）常把 "true"/"null"/null 等垃圾值回传，
// 严格 zod 校验会反复拒绝导致重试耗尽（整集拆分失败），这里在校验前统一归一。
// 注：zod v4 的 z.preprocess 会破坏 object 类型推断，改用带显式输出类型的 z.custom ───
export function stripJunk(v: unknown) {
  if (typeof v === 'string' && ['', 'null', 'undefined', 'NULL', 'Null', 'none'].includes(v.trim())) return undefined
  return v
}
export const lenientString = z.custom<string | undefined>(v => {
  const clean = stripJunk(v)
  return clean === undefined || typeof clean === 'string'
})
export const lenientBool = z.custom<boolean | undefined>(v => {
  if (['true', 'True', 'false', 'False', 0, 1].includes(v as any)) return true
  const clean = stripJunk(v)
  return clean === undefined || typeof clean === 'boolean'
})
export const lenientNumber = z.custom<number | undefined>(v => {
  const clean = stripJunk(v)
  if (clean === undefined) return true
  if (typeof clean === 'number') return true
  return typeof clean === 'string' && clean.trim() !== '' && !Number.isNaN(Number(clean))
})
export const lenientNullableNumber = z.custom<number | null | undefined>(v => {
  const clean = stripJunk(v)
  if (clean === undefined || clean === null) return true
  if (typeof clean === 'number') return true
  return typeof clean === 'string' && clean.trim() !== '' && !Number.isNaN(Number(clean))
})
export const lenientNumberArray = z.custom<number[] | undefined>(v => {
  const clean = stripJunk(v)
  return clean === undefined || Array.isArray(clean)
})

// 归一后的取值辅助（与上面校验规则一一对应）
export function toCleanString(v: unknown): string | undefined {
  const clean = stripJunk(v)
  return typeof clean === 'string' ? clean : undefined
}
export function toCleanBool(v: unknown): boolean | undefined {
  if (v === 'true' || v === 'True' || v === 1) return true
  if (v === 'false' || v === 'False' || v === 0) return false
  const clean = stripJunk(v)
  return typeof clean === 'boolean' ? clean : undefined
}
export function toCleanNumber(v: unknown): number | undefined {
  const clean = stripJunk(v)
  if (typeof clean === 'number') return clean
  if (typeof clean === 'string' && clean.trim() !== '' && !Number.isNaN(Number(clean))) return Number(clean)
  return undefined
}
export function toCleanNullableNumber(v: unknown): number | null | undefined {
  const clean = stripJunk(v)
  if (clean === null) return null
  if (typeof clean === 'number') return clean
  if (typeof clean === 'string' && clean.trim() !== '' && !Number.isNaN(Number(clean))) return Number(clean)
  return clean === undefined ? null : undefined
}
export function toCleanNumberArray(v: unknown): number[] | undefined {
  const clean = stripJunk(v)
  if (!Array.isArray(clean)) return undefined
  return clean
    .map(x => (typeof x === 'string' && x.trim() !== '' && !Number.isNaN(Number(x)) ? Number(x) : x))
    .filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
}

export const storyboardFields = z.object({
  shot_number: z.custom<number>(v => toCleanNumber(v) !== undefined),
  title: lenientString,
  shot_type: lenientString,
  angle: lenientString,
  movement: lenientString,
  location: lenientString,
  time: lenientString,
  description: lenientString,
  result: lenientString,
  atmosphere: lenientString,
  image_prompt: lenientString,
  video_prompt: lenientString,
  bgm_prompt: lenientString,
  sound_effect: lenientString,
  duration: lenientNumber,
  scene_id: lenientNullableNumber,
  character_ids: lenientNumberArray,
  prop_ids: lenientNumberArray,
})
