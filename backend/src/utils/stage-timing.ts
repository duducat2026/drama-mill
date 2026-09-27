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
 * 阶段耗时统计 — 每个模块/阶段落 stage_timings，供单集耗时明细与总耗时聚合
 * 文本类阶段（改写/提取/分镜/提示词）用 withTiming 包裹执行入口；
 * 图片/视频/拼接阶段由 sys_task、video_merges 的时间戳聚合得出
 */
import { eq, and, or, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from './response.js'

export const STAGE_LABELS: Record<string, string> = {
  script_rewrite: '剧本改写',
  extract_characters: '角色提取',
  extract_scenes: '场景提取',
  extract_props: '道具提取',
  storyboard_split: '分镜拆分',
  video_prompts: '视频提示词',
  generate_images: '图片生成',
  generate_videos: '视频生成',
  merge_episode: '视频拼接',
}

/** 记录一次阶段执行（同步任务直接包裹） */
export async function recordStage(
  episodeId: number,
  dramaId: number,
  stage: string,
  startedAt: number,
  status: 'done' | 'failed' = 'done',
  meta?: Record<string, unknown>,
) {
  try {
    const finished = now()
    await db.insert(schema.stageTimings).values({
      episodeId,
      dramaId,
      stage,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: finished,
      durationMs: Date.now() - startedAt,
      status,
      meta: meta ? JSON.stringify(meta) : null,
      createdAt: finished,
    })
  } catch (err) {
    console.warn('[timing] 阶段耗时记录失败:', (err as Error).message)
  }
}

/** 包裹异步执行：成功/失败都落耗时记录 */
export async function withTiming<T>(
  episodeId: number,
  dramaId: number,
  stage: string,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  const startedAt = Date.now()
  try {
    const result = await fn()
    await recordStage(episodeId, dramaId, stage, startedAt, 'done', meta)
    return result
  } catch (err) {
    await recordStage(episodeId, dramaId, stage, startedAt, 'failed', meta)
    throw err
  }
}

function parseTs(ts: string | null | undefined): number | null {
  if (!ts) return null
  const t = new Date(ts).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * 单集耗时明细：文本阶段取 stage_timings 最近一次；
 * 图片/视频阶段按本集归属任务的 created_at→completed_at 聚合；拼接取最近一次
 */
export async function getEpisodeTimings(episodeId: number) {
  // 只取 dramaId（不加载 content MEDIUMTEXT）
  const [ep] = await db.select({ dramaId: schema.episodes.dramaId }).from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (!ep) return null

  const rows = await db.select().from(schema.stageTimings).where(eq(schema.stageTimings.episodeId, episodeId))

  // 图片/视频任务归属：与 generation-tasks 同口径（只取 id，不加载 prompt TEXT 等大字段）
  const sbs = await db.select({ id: schema.storyboards.id }).from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId))
  const storyboardIds = sbs.map(s => s.id)
  const epScenes = await db.select({ sceneId: schema.episodeScenes.sceneId }).from(schema.episodeScenes).where(eq(schema.episodeScenes.episodeId, episodeId))
  const sceneIds = epScenes.map(r => r.sceneId)
  const epChars = await db.select({ characterId: schema.episodeCharacters.characterId }).from(schema.episodeCharacters).where(eq(schema.episodeCharacters.episodeId, episodeId))
  const characterIds = epChars.map(r => r.characterId)
  const dramaProps = await db.select({ id: schema.props.id }).from(schema.props).where(eq(schema.props.dramaId, ep.dramaId))
  const propIds = dramaProps.map(p => p.id)

  // 归属条件下推 SQL（与 generation-tasks 同模式），只取耗时聚合所需列
  const orConds: any[] = []
  if (storyboardIds.length) orConds.push(inArray(schema.sysTask.storyboardId, storyboardIds))
  if (sceneIds.length) orConds.push(inArray(schema.sysTask.sceneId, sceneIds))
  if (characterIds.length) orConds.push(inArray(schema.sysTask.characterId, characterIds))
  if (propIds.length) orConds.push(inArray(schema.sysTask.propId, propIds))
  const tasks: any[] = orConds.length
    ? await db.select({
        type: schema.sysTask.type, createdAt: schema.sysTask.createdAt, completedAt: schema.sysTask.completedAt,
      }).from(schema.sysTask).where(and(eq(schema.sysTask.dramaId, ep.dramaId), or(...orConds)))
    : []

  const merges = await db.select().from(schema.videoMerges).where(eq(schema.videoMerges.episodeId, episodeId))

  /** 按任务集合聚合耗时：首个任务创建 → 最后一个任务完成 */
  function aggregateTaskDuration(list: typeof tasks) {
    const starts = list.map(t => parseTs(t.createdAt)).filter((t): t is number => t != null)
    const ends = list.map(t => parseTs(t.completedAt)).filter((t): t is number => t != null)
    if (!starts.length || !ends.length) return null
    return { duration_ms: Math.max(0, Math.max(...ends) - Math.min(...starts)), count: list.length }
  }

  const stages: Array<{ stage: string; label: string; duration_ms: number | null; last_run_at: string | null; status: string | null }> = []

  const textStages = ['script_rewrite', 'extract_characters', 'extract_scenes', 'extract_props', 'storyboard_split', 'video_prompts']
  for (const stage of textStages) {
    const runs = rows.filter(r => r.stage === stage).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    const last = runs[0]
    stages.push({
      stage,
      label: STAGE_LABELS[stage],
      duration_ms: last?.durationMs ?? null,
      last_run_at: last?.createdAt ?? null,
      status: last?.status ?? null,
    })
  }

  const imageAgg = aggregateTaskDuration(tasks.filter(t => t.type === 'image'))
  stages.push({ stage: 'generate_images', label: STAGE_LABELS.generate_images, duration_ms: imageAgg?.duration_ms ?? null, last_run_at: null, status: imageAgg ? 'done' : null })
  const videoAgg = aggregateTaskDuration(tasks.filter(t => t.type === 'video'))
  stages.push({ stage: 'generate_videos', label: STAGE_LABELS.generate_videos, duration_ms: videoAgg?.duration_ms ?? null, last_run_at: null, status: videoAgg ? 'done' : null })

  const lastMerge = [...merges].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0]
  const mergeStart = parseTs(lastMerge?.createdAt)
  const mergeEnd = parseTs(lastMerge?.completedAt)
  stages.push({
    stage: 'merge_episode',
    label: STAGE_LABELS.merge_episode,
    duration_ms: mergeStart != null && mergeEnd != null ? Math.max(0, mergeEnd - mergeStart) : null,
    last_run_at: lastMerge?.createdAt ?? null,
    status: lastMerge?.status ?? null,
  })

  // 单集总耗时：最早开始 → 最晚结束（跨全部阶段与任务）
  const allStarts: number[] = []
  const allEnds: number[] = []
  for (const r of rows) {
    const s = parseTs(r.startedAt)
    const f = parseTs(r.finishedAt)
    if (s != null) allStarts.push(s)
    if (f != null) allEnds.push(f)
  }
  for (const t of tasks) {
    const s = parseTs(t.createdAt)
    const f = parseTs(t.completedAt)
    if (s != null) allStarts.push(s)
    if (f != null) allEnds.push(f)
  }
  if (mergeStart != null) allStarts.push(mergeStart)
  if (mergeEnd != null) allEnds.push(mergeEnd)

  const totalMs = allStarts.length && allEnds.length ? Math.max(0, Math.max(...allEnds) - Math.min(...allStarts)) : null
  const sumMs = stages.reduce((acc, s) => acc + (s.duration_ms || 0), 0)

  return {
    episode_id: episodeId,
    stages,
    total_duration_ms: totalMs,
    sum_stage_duration_ms: sumMs || null,
  }
}
