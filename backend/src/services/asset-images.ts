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
 * 资产图片生成共享逻辑 — 单张/批量路由与生产编排器共用
 * 角色（三视图定妆）/ 场景（固定视角）/ 道具（白底单品）
 */
import { eq, and } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { generateImage } from './generation.js'
import { getDramaStylePrompt } from './style-preset.js'
import { ensureCharacterFinalPrompt, ensurePropFinalPrompt, ensureSceneFinalPrompt } from './final-prompt.js'
import { logTaskProgress, logTaskSuccess } from '../utils/task-logger.js'

const CHARACTER_IMAGE_SIZE = '1920x1080'
// 道具图：白底单品静物，方形画布
const PROP_IMAGE_SIZE = '1024x1024'

export interface AssetImageOpts {
  model?: string
  configId?: number
  textModel?: string
  textConfigId?: number
}

export interface BatchImageResult {
  asset_id: number
  task_id: number
}

// 图片任务活跃态：与 asset-watchdog 的去重判定保持一致（排队中也算占着资产）
const ACTIVE_TASK_STATUSES = ['processing', 'pending']

/** 剧集所有者（任务归属/落盘租户目录用）：编排与批量入口无请求态用户，按剧集 owner 落库 */
async function dramaOwnerId(dramaId: number | null | undefined): Promise<number | undefined> {
  if (!dramaId) return undefined
  const [d] = await db.select({ userId: schema.dramas.userId }).from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  return d?.userId ?? undefined
}

/**
 * 基于状态的提交去重：同一资产已有进行中的图片任务时，复用其任务 ID 而不新建。
 * 适用所有入口（单个/批量路由、生产编排、看门狗），避免重复点击/多源重提在队列里堆积重复任务。
 */
async function findActiveImageTask(kind: 'characterId' | 'sceneId' | 'propId', assetId: number): Promise<number | null> {
  const rows = await db.select({ id: schema.sysTask.id, status: schema.sysTask.status })
    .from(schema.sysTask)
    .where(and(eq(schema.sysTask.type, 'image'), eq(schema.sysTask[kind], assetId)))
  const active = rows.find(t => ACTIVE_TASK_STATUSES.includes(t.status || ''))
  return active?.id ?? null
}

function characterImagePrompt(char: typeof schema.characters.$inferSelect, stylePrompt = '') {
  return [
    stylePrompt || '',
    char.name,
    char.appearance || char.description || '人物立绘',
    char.styling || '',
    '16:9 横版角色定妆照',
    '半身角色海报构图',
    '正面',
    '高质量',
    '白色背景',
  ].filter(Boolean).join(', ')
}

/** 本地兜底提示词：白底单品，不掺杂其他元素 */
function propImagePrompt(prop: typeof schema.props.$inferSelect, stylePrompt = '') {
  return [
    stylePrompt || '',
    `single product photo of ${prop.name}`,
    prop.description || '',
    'isolated on a pure white background',
    'no other objects, no people, no scenery',
    'soft even studio lighting',
    'high detail',
    'no text, no watermark',
  ].filter(Boolean).join(', ')
}

/** 角色图片生成核心逻辑（单个/批量共用）：返回生成任务 ID */
export async function generateCharacterImageFor(id: number, episodeId: number, opts: AssetImageOpts = {}): Promise<number> {
  const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
  if (!char) throw new Error('Character not found')
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (!ep) throw new Error('Episode not found')

  // 已有进行中的图片任务：直接复用，不重复提交（幂等）
  const existing = await findActiveImageTask('characterId', id)
  if (existing) {
    logTaskProgress('CharacterImage', 'duplicate-reuse', { characterId: id, taskId: existing })
    return existing
  }

  const stylePrompt = await getDramaStylePrompt(char.dramaId)
  const finalPrompt = await ensureCharacterFinalPrompt(char, ep.id, false, { model: opts.textModel, configId: opts.textConfigId })
  const prompt = finalPrompt || characterImagePrompt(char, stylePrompt)
  return generateImage({ characterId: id, dramaId: char.dramaId, prompt, model: opts.model, size: CHARACTER_IMAGE_SIZE, configId: opts.configId ?? ep.imageConfigId ?? undefined, userId: await dramaOwnerId(char.dramaId) })
}

/** 场景图片生成核心逻辑（单个/批量共用）：返回生成任务 ID */
export async function generateSceneImageFor(id: number, episodeId: number, opts: AssetImageOpts = {}): Promise<number> {
  const [scene] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, id))
  if (!scene) throw new Error('Scene not found')
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (!ep) throw new Error('Episode not found')

  // 已有进行中的图片任务：直接复用，不重复提交（幂等）
  const existing = await findActiveImageTask('sceneId', id)
  if (existing) {
    logTaskProgress('SceneImage', 'duplicate-reuse', { sceneId: id, taskId: existing })
    return existing
  }

  const stylePrompt = await getDramaStylePrompt(scene.dramaId)
  const finalPrompt = await ensureSceneFinalPrompt(scene, ep.id, false, { model: opts.textModel, configId: opts.textConfigId })
  const prompt = finalPrompt || [
    stylePrompt || '',
    scene.location,
    scene.time || '',
    scene.prompt || '高质量场景',
    scene.lighting || '电影感光影',
  ].filter(Boolean).join(', ')

  await db.update(schema.scenes).set({ status: 'processing', updatedAt: now() }).where(eq(schema.scenes.id, id))
  return generateImage({ sceneId: id, dramaId: scene.dramaId, prompt, model: opts.model, configId: opts.configId ?? ep.imageConfigId ?? undefined, userId: await dramaOwnerId(scene.dramaId) })
}

/** 道具图片生成核心逻辑（单个/批量共用）：返回生成任务 ID */
export async function generatePropImageFor(id: number, episodeId: number, opts: AssetImageOpts = {}): Promise<number> {
  const [prop] = await db.select().from(schema.props).where(eq(schema.props.id, id))
  if (!prop) throw new Error('Prop not found')
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (!ep) throw new Error('Episode not found')

  // 已有进行中的图片任务：直接复用，不重复提交（幂等）
  const existing = await findActiveImageTask('propId', id)
  if (existing) {
    logTaskProgress('PropImage', 'duplicate-reuse', { propId: id, taskId: existing })
    return existing
  }

  const stylePrompt = await getDramaStylePrompt(prop.dramaId)
  const finalPrompt = await ensurePropFinalPrompt(prop, ep.id, false, { model: opts.textModel, configId: opts.textConfigId })
  const prompt = finalPrompt || propImagePrompt(prop, stylePrompt)
  return generateImage({ propId: id, dramaId: prop.dramaId, prompt, model: opts.model, size: PROP_IMAGE_SIZE, configId: opts.configId ?? ep.imageConfigId ?? undefined, userId: await dramaOwnerId(prop.dramaId) })
}

type AssetKind = 'character' | 'scene' | 'prop'
const KIND_LABEL: Record<AssetKind, string> = { character: 'CharacterImage', scene: 'SceneImage', prop: 'PropImage' }

async function batchGenerate(
  kind: AssetKind,
  episodeId: number,
  ids: number[],
  genFor: (id: number, episodeId: number, opts: AssetImageOpts) => Promise<number>,
  opts: AssetImageOpts,
): Promise<BatchImageResult[]> {
  const results: BatchImageResult[] = []
  for (const id of ids) {
    try {
      results.push({ asset_id: id, task_id: await genFor(id, episodeId, opts) })
    } catch { /* 单个资产失败不阻塞批量，编排器按终态校验兜底 */ }
  }
  logTaskSuccess(KIND_LABEL[kind], 'batch-generate', { episodeId, requested: ids.length, started: results.length })
  return results
}

export function batchGenerateCharacterImages(episodeId: number, ids: number[], opts: AssetImageOpts = {}) {
  return batchGenerate('character', episodeId, ids, generateCharacterImageFor, opts)
}

export function batchGenerateSceneImages(episodeId: number, ids: number[], opts: AssetImageOpts = {}) {
  return batchGenerate('scene', episodeId, ids, generateSceneImageFor, opts)
}

export function batchGeneratePropImages(episodeId: number, ids: number[], opts: AssetImageOpts = {}) {
  return batchGenerate('prop', episodeId, ids, generatePropImageFor, opts)
}
