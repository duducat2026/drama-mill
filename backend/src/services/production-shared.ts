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
 * 自动化生产编排 — 共享层：运行状态类型、进程内存态 runs 注册表、步骤定义、
 * 视频槽位信号量、DB 状态读写 helper 与前置输入校验（供 steps/runner/门面共同引用）
 */
import { eq, and, isNull, inArray, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { getEpisodePipelineSteps } from './pipeline-status.js'
import { PROD_EPISODE_CONCURRENCY } from '../utils/rate-config.js'
import { logTaskProgress } from '../utils/task-logger.js'

export type ProductionStatus = 'running' | 'paused' | 'done' | 'error'

export interface ProductionRun {
  status: ProductionStatus
  current_episode_id: number | null
  current_episode_number: number | null
  current_step: string | null
  error: string | null
  started_at: string
  finished_at?: string
}

const runs = new Map<number, ProductionRun>()

/** 当前运行中的生产状态（编排循环与门面共用同一份进程内存态） */
export function getActiveRun(dramaId: number): ProductionRun | null {
  return runs.get(dramaId) || null
}

export function setActiveRun(dramaId: number, run: ProductionRun) {
  runs.set(dramaId, run)
}

export const PAUSED = Symbol('production-paused')
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// 暂停标志由外部请求异步修改，需绕过 TS 类型收窄读取真实状态
export function isPaused(run: ProductionRun): boolean {
  return (run.status as ProductionStatus) === 'paused'
}

// ─── 视频生成槽位信号量：限制同时生成视频的集数，避免多集同时占满视频模型并发槽位 ───
let videoGenCount = 0

/** 等待视频生成槽位（轮询 + 暂停检查），获取后递增计数器 */
export async function waitForVideoSlot(run: ProductionRun): Promise<void> {
  while (true) {
    if (isPaused(run)) throw PAUSED
    if (videoGenCount < PROD_EPISODE_CONCURRENCY) {
      videoGenCount++
      return
    }
    await sleep(3000)
  }
}

/** 释放视频生成槽位 */
export function releaseVideoSlot(): void {
  videoGenCount--
}

export const PRODUCTION_STEPS = [
  { key: 'script_rewrite', label: '剧本改写' },
  { key: 'extract_assets', label: '资产提取' },
  { key: 'storyboard_split', label: '分镜拆分' },
  { key: 'video_prompts', label: '视频提示词' },
  { key: 'asset_images', label: '资产图片' },
  { key: 'generate_videos', label: '视频生成' },
] as const

export type EpisodeRow = typeof schema.episodes.$inferSelect
export type StepKey = typeof PRODUCTION_STEPS[number]['key']
export type StepFn = () => Promise<void>

export async function getDramaEpisodes(dramaId: number): Promise<EpisodeRow[]> {
  const rows = await db.select().from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, dramaId), isNull(schema.episodes.deletedAt)))
  return rows.sort((a, b) => a.episodeNumber - b.episodeNumber)
}

/** 状态查询专用轻量子集：不拉剧本全文，用 SQL 布尔替代（步骤推导只关心是否非空）；
 * 编排循环仍用全量 getDramaEpisodes（剧本改写需要原文） */
export async function getDramaEpisodesLite(dramaId: number) {
  const rows = await db.select({
    id: schema.episodes.id,
    dramaId: schema.episodes.dramaId,
    episodeNumber: schema.episodes.episodeNumber,
    title: schema.episodes.title,
    status: schema.episodes.status,
    content: sql<string | null>`CASE WHEN content IS NOT NULL AND content <> '' THEN '1' ELSE NULL END`,
    scriptContent: sql<string | null>`CASE WHEN script_content IS NOT NULL AND script_content <> '' THEN '1' ELSE NULL END`,
  }).from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, dramaId), isNull(schema.episodes.deletedAt)))
  return rows.sort((a, b) => a.episodeNumber - b.episodeNumber)
}

export async function setEpisodeStatus(episodeId: number, status: string) {
  await db.update(schema.episodes).set({ status, updatedAt: now() }).where(eq(schema.episodes.id, episodeId))
}

export async function setDramaStatus(dramaId: number, status: string) {
  await db.update(schema.dramas).set({ status, updatedAt: now() }).where(eq(schema.dramas.id, dramaId))
}

/** 集是否已完成：优先看手动标记的 episodes.status，其次看流水线视频生成状态；拼接不再属于自动生产，按需手动触发 */
export async function isEpisodeCompleted(episodeId: number): Promise<boolean> {
  // 手动标记为 completed 的集直接跳过（规避部分镜头未完成阻塞后续集生产）
  const [ep] = await db.select({ status: schema.episodes.status }).from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (ep?.status === 'completed') return true
  const steps = await getEpisodePipelineSteps(episodeId)
  return steps?.generate_videos.status === 'done'
}

/** 本集关联的角色/场景/道具（含旧数据兼容），过滤软删；巡检看门狗也复用。
 *  先查关联表拿 id，再按 inArray 定点查资产，避免全表加载全平台资产 */
export async function getEpisodeAssets(episodeId: number) {
  const charLinks = await db.select({ characterId: schema.episodeCharacters.characterId }).from(schema.episodeCharacters).where(eq(schema.episodeCharacters.episodeId, episodeId))
  const sceneLinks = await db.select({ sceneId: schema.episodeScenes.sceneId }).from(schema.episodeScenes).where(eq(schema.episodeScenes.episodeId, episodeId))
  const propLinks = await db.select({ propId: schema.episodeProps.propId }).from(schema.episodeProps).where(eq(schema.episodeProps.episodeId, episodeId))
  const charIds = [...new Set(charLinks.map(l => l.characterId))]
  const sceneIds = [...new Set(sceneLinks.map(l => l.sceneId))]
  const propIds = [...new Set(propLinks.map(l => l.propId))]
  const chars = charIds.length
    ? await db.select().from(schema.characters).where(and(inArray(schema.characters.id, charIds), isNull(schema.characters.deletedAt)))
    : []
  const scenes = sceneIds.length
    ? await db.select().from(schema.scenes).where(and(inArray(schema.scenes.id, sceneIds), isNull(schema.scenes.deletedAt)))
    : []
  const props = propIds.length
    ? await db.select().from(schema.props).where(and(inArray(schema.props.id, propIds), isNull(schema.props.deletedAt)))
    : []
  return { chars, scenes, props }
}

/** 重新读取最新集数据（编排期间 scriptContent 等字段可能被上一步更新，入参行可能已过时） */
export async function getFreshEpisode(episodeId: number): Promise<EpisodeRow | undefined> {
  const [row] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  return row
}

export async function getEpisodeStoryboards(episodeId: number) {
  return db.select().from(schema.storyboards)
    .where(and(eq(schema.storyboards.episodeId, episodeId), isNull(schema.storyboards.deletedAt)))
}

/**
 * 步骤前置输入校验：返回缺失的上一步 key（空数组 = 输入齐备）。
 * 按 DB 实时数据检查「上一步产出的素材/输入」，供编排主循环在执行每步前回补缺失环节。
 * script_rewrite 无上游可回补：缺原文直接抛错。
 */
export async function missingStepInputs(ep: EpisodeRow, key: StepKey): Promise<StepKey[]> {
  const fresh = await getFreshEpisode(ep.id)
  const missing: StepKey[] = []
  switch (key) {
    case 'script_rewrite':
      if (!fresh?.content) throw new Error('缺少原文内容，无法改写剧本')
      break
    case 'extract_assets':
      if (!fresh?.scriptContent) missing.push('script_rewrite')
      break
    case 'storyboard_split': {
      if (!fresh?.scriptContent) missing.push('script_rewrite')
      const { chars, scenes } = await getEpisodeAssets(ep.id)
      if (!chars.length || !scenes.length) missing.push('extract_assets')
      break
    }
    case 'video_prompts': {
      const sbs = await getEpisodeStoryboards(ep.id)
      if (!sbs.length) missing.push('storyboard_split')
      break
    }
    case 'asset_images': {
      const { chars, scenes } = await getEpisodeAssets(ep.id)
      if (!chars.length || !scenes.length) missing.push('extract_assets')
      break
    }
    case 'generate_videos': {
      const sbs = await getEpisodeStoryboards(ep.id)
      if (!sbs.length) missing.push('storyboard_split')
      else if (sbs.some(sb => !sb.videoPrompt)) missing.push('video_prompts')
      const { chars, scenes, props } = await getEpisodeAssets(ep.id)
      if ([...chars, ...scenes, ...props].some(a => !a.imageUrl)) missing.push('asset_images')
      break
    }
  }
  return missing
}

/** 轮询助手：直到 check 返回 true；每次迭代检查暂停标志与超时 */
export async function pollUntil(check: () => Promise<boolean>, run: ProductionRun, opts: { intervalMs?: number; timeoutMs: number; timeoutMsg: string }) {
  const interval = opts.intervalMs ?? 5000
  const start = Date.now()
  while (true) {
    if (isPaused(run)) throw PAUSED
    if (await check()) return
    if (Date.now() - start > opts.timeoutMs) throw new Error(opts.timeoutMsg)
    await sleep(interval)
  }
}

/**
 * 执行步骤前校验上一步产出的素材/输入是否齐备；缺失则回补执行对应上一步（步骤本身幂等，只补缺）。
 * 回补后二次校验仍缺失才抛错；depth 上限兜底防止意外循环。
 */
export async function ensureStepInputs(
  ep: EpisodeRow, dramaId: number, run: ProductionRun, userId: number | undefined,
  key: StepKey, stepFns: Record<StepKey, StepFn>, depth = 0,
) {
  if (depth > PRODUCTION_STEPS.length) throw new Error(`步骤「${key}」的输入经多轮回补仍缺失，请人工检查数据`)
  const missing = await missingStepInputs(ep, key)
  if (!missing.length) return
  for (const dep of missing) {
    if (isPaused(run)) throw PAUSED
    logTaskProgress('Production', 'backfill-input', { dramaId, episodeNumber: ep.episodeNumber, step: key, missing: dep })
    // 回补上一步前，先保证上一步自己的输入齐备（如视频生成缺提示词、提示词缺分镜时逐级回溯）
    await ensureStepInputs(ep, dramaId, run, userId, dep, stepFns, depth + 1)
    await stepFns[dep]()
  }
  const stillMissing = await missingStepInputs(ep, key)
  if (stillMissing.length) throw new Error(`步骤「${key}」的输入缺失，回补「${stillMissing.join('、')}」后仍未产出，请人工检查`)
}
