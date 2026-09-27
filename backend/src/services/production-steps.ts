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
 * 自动化生产编排 — 7 个步骤实现（均幂等：先查 DB 判定已完成则跳过）与前置输入校验
 */
import { eq, and, isNull, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { executeAgentRun } from './agent-run.js'
import { startExtraction, getExtractionStatus, EXTRACT_TARGETS } from './extraction.js'
import { startVideoPromptBatch, getVideoPromptBatchStatus } from './video-prompts.js'
import { batchGenerateCharacterImages, batchGenerateSceneImages, batchGeneratePropImages } from './asset-images.js'
import { submitEpisodeVideoBatch, getEpisodeVideoProgress } from './episode-videos.js'
import { withTiming } from '../utils/stage-timing.js'
import { recordTextUsageFromResult } from './cost.js'
import { resolveTextConfigMeta } from './ai.js'
import { logTaskProgress } from '../utils/task-logger.js'
import {
  PAUSED, sleep, isPaused, pollUntil,
  getEpisodeAssets, getEpisodeStoryboards,
  type EpisodeRow, type ProductionRun, type StepKey, type StepFn,
} from './production-shared.js'

// getEpisodeAssets 定义在 production-shared（避免与输入校验循环依赖），门面从这里透出，外部 import 路径不变
export { getEpisodeAssets }

// ─── 7 个步骤实现（均幂等：先查 DB 判定已完成则跳过） ───

export async function stepScriptRewrite(ep: EpisodeRow, dramaId: number, userId?: number) {
  if (ep.scriptContent) return
  if (!ep.content) throw new Error('缺少原文内容，无法改写剧本')
  // 耗时打点：script_rewrite；成本采集：按实际解析到的文本配置记录用量
  const result = await withTiming(ep.id, dramaId, 'script_rewrite', () =>
    executeAgentRun('script_rewriter', '请读取剧本并改写为格式化剧本，然后保存', { episodeId: ep.id, dramaId, userId }))
  const costMeta = await resolveTextConfigMeta(userId)
  await recordTextUsageFromResult(result, costMeta, {
    userId, dramaId, episodeId: ep.id, configId: costMeta?.configId, detail: 'script_rewrite',
  })
  const [after] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, ep.id))
  if (!after?.scriptContent) throw new Error('剧本改写未产出结果，请检查 Agent 配置后重试')
}

export async function stepExtractAssets(ep: EpisodeRow, dramaId: number, run: ProductionRun, userId?: number) {
  const { chars, scenes } = await getEpisodeAssets(ep.id)
  if (chars.length > 0 && scenes.length > 0) return
  for (const target of EXTRACT_TARGETS) startExtraction(ep.id, dramaId, target, { userId })
  await pollUntil(async () => {
    const st = getExtractionStatus(ep.id)
    const settled = EXTRACT_TARGETS.every(t => st[t] && st[t]!.status !== 'running')
    if (!settled) return false
    const failed = EXTRACT_TARGETS.filter(t => st[t]?.status === 'error')
    if (failed.length) throw new Error(`资产提取失败：${failed.join('、')}（${st[failed[0]]?.error || '未知错误'}）`)
    return true
  }, run, { timeoutMs: 30 * 60 * 1000, timeoutMsg: '资产提取超时（30 分钟）' })
  const after = await getEpisodeAssets(ep.id)
  if (!after.chars.length || !after.scenes.length) throw new Error('资产提取未产出角色或场景，请检查剧本内容')
}

export async function stepStoryboardSplit(ep: EpisodeRow, dramaId: number, userId?: number) {
  const sbs = await getEpisodeStoryboards(ep.id)
  if (sbs.length > 0) return

  const { chars, scenes, props } = await getEpisodeAssets(ep.id)
  const charList = chars.length ? chars.map(c => `${c.name}(ID:${c.id})`).join('、') : '（当前集还没有角色）'
  const sceneList = scenes.length ? scenes.map(s => `${s.location} · ${s.time || '未设时间'}(ID:${s.id})`).join('、') : '（当前集还没有场景）'
  const propList = props.length ? props.map(p => `${p.name}(ID:${p.id})`).join('、') : '（当前集还没有道具）'
  const message = `请基于当前集剧本拆分分镜（不需要生成视频提示词，video_prompt 在视频生成阶段按需生成）。

当前集已有角色：${charList}
当前集已有场景：${sceneList}
当前集已有道具：${propList}

绑定要求：
- 每个镜头必须根据剧本内容，从上述当前集已有角色中选出出场的角色绑定 character_ids（ID 必须来自上述列表；有角色出场就必须绑定，不要遗漏）
- 每个镜头尽量匹配上述已有场景填写 scene_id（ID 必须来自上述列表），不要凭空创造新场景
- 每个镜头出现关键道具（被使用、交接、特写或在画面中明显可见）时，从上述当前集已有道具中绑定 prop_ids（ID 必须来自上述列表）；没有道具出现可传空数组
- 只有纯环境空镜头才可以不绑定角色`

  // 耗时打点：storyboard_split；成本采集：文本用量
  const result = await withTiming(ep.id, dramaId, 'storyboard_split', () =>
    executeAgentRun('storyboard_breaker', message, { episodeId: ep.id, dramaId, maxSteps: 40, userId }))
  const costMeta = await resolveTextConfigMeta(userId)
  await recordTextUsageFromResult(result, costMeta, {
    userId, dramaId, episodeId: ep.id, configId: costMeta?.configId, detail: 'storyboard_split',
  })
  const after = await getEpisodeStoryboards(ep.id)
  if (!after.length) throw new Error('分镜拆分未产出结果，请重试')
}

export async function stepVideoPrompts(ep: EpisodeRow, dramaId: number, run: ProductionRun, userId?: number) {
  const sbs = await getEpisodeStoryboards(ep.id)
  if (sbs.length && sbs.every(sb => !!sb.videoPrompt)) return
  await startVideoPromptBatch(ep.id, dramaId, { userId })
  await pollUntil(async () => {
    const st = getVideoPromptBatchStatus(ep.id)
    if (!st) return false
    if (st.status === 'error') throw new Error(`视频提示词生成失败：${st.error || '未知错误'}`)
    return st.status === 'done'
  }, run, { timeoutMs: 60 * 60 * 1000, timeoutMsg: '视频提示词生成超时（60 分钟）' })
  const after = await getEpisodeStoryboards(ep.id)
  const missing = after.filter(sb => !sb.videoPrompt)
  if (missing.length) throw new Error(`仍有 ${missing.length} 个分镜缺少视频提示词`)
}

/** 生图缺图自动补跑轮数（首跑之外的重试次数），仍缺才判步骤失败 */
const ASSET_IMAGE_RETRY_ROUNDS = 2

export async function stepAssetImages(ep: EpisodeRow, run: ProductionRun) {
  // 首跑 + N 轮自动补跑：每轮只重新提交仍缺 imageUrl 的资产，瞬时失败不直接终止项目
  for (let attempt = 0; ; attempt++) {
    if (isPaused(run)) throw PAUSED
    const { chars, scenes, props } = await getEpisodeAssets(ep.id)
    const noImageChars = chars.filter(c => !c.imageUrl)
    const noImageScenes = scenes.filter(s => !s.imageUrl)
    const noImageProps = props.filter(p => !p.imageUrl)
    if (!noImageChars.length && !noImageScenes.length && !noImageProps.length) return
    if (attempt > ASSET_IMAGE_RETRY_ROUNDS) break

    if (attempt > 0) {
      logTaskProgress('Production', 'asset-images-retry', {
        episodeId: ep.id, attempt,
        chars: noImageChars.length, scenes: noImageScenes.length, props: noImageProps.length,
      })
      await sleep(5000) // 重试前稍等，避开上游瞬时限流
    }

    const taskIds: number[] = [
      ...(await batchGenerateCharacterImages(ep.id, noImageChars.map(c => c.id))).map(r => r.task_id),
      ...(await batchGenerateSceneImages(ep.id, noImageScenes.map(s => s.id))).map(r => r.task_id),
      ...(await batchGeneratePropImages(ep.id, noImageProps.map(p => p.id))).map(r => r.task_id),
    ]
    await pollUntil(async () => {
      if (!taskIds.length) return true
      // 按 id 定点查询，避免每轮轮询全表扫 sys_task（随任务累积只增不减）
      const matched = await db.select({ id: schema.sysTask.id, status: schema.sysTask.status })
        .from(schema.sysTask).where(inArray(schema.sysTask.id, taskIds))
      return matched.length === taskIds.length && matched.every(t => t.status !== 'processing' && t.status !== 'pending')
    }, run, { timeoutMs: 60 * 60 * 1000, timeoutMsg: '资产图片生成超时（60 分钟）' })
  }

  const after = await getEpisodeAssets(ep.id)
  const stillMissing = [
    ...after.chars.filter(c => !c.imageUrl).map(c => `角色「${c.name}」`),
    ...after.scenes.filter(s => !s.imageUrl).map(s => `场景「${s.location}」`),
    ...after.props.filter(p => !p.imageUrl).map(p => `道具「${p.name}」`),
  ]
  if (stillMissing.length) throw new Error(`资产图片未全部生成（已自动补跑 ${ASSET_IMAGE_RETRY_ROUNDS} 轮）：${stillMissing.join('、')}`)
}

export async function stepGenerateVideos(ep: EpisodeRow, dramaId: number, run: ProductionRun) {
  const before = await getEpisodeVideoProgress(ep.id)
  if (before.total > 0 && before.completed === before.total) return
  if (!before.total) throw new Error('本集没有分镜，无法生成视频')

  const { submitted } = await submitEpisodeVideoBatch(ep.id, dramaId)
  const taskIds = submitted.map(s => s.task_id)
  await pollUntil(async () => {
    if (!taskIds.length) return true
    // 按 id 定点查询，避免每轮轮询全表扫 sys_task（随任务累积只增不减）
    const matched = await db.select({ id: schema.sysTask.id, status: schema.sysTask.status })
      .from(schema.sysTask).where(inArray(schema.sysTask.id, taskIds))
    return matched.length === taskIds.length && matched.every(t => t.status !== 'processing' && t.status !== 'pending')
  }, run, { intervalMs: 10000, timeoutMs: 3 * 60 * 60 * 1000, timeoutMsg: '视频生成超时（3 小时）' })

  const after = await getEpisodeVideoProgress(ep.id)
  if (after.completed !== after.total) {
    // 只查本批任务的失败记录取错误原因，不全表扫 sys_task
    const failedTasks = await db.select({ errorMsg: schema.sysTask.errorMsg })
      .from(schema.sysTask)
      .where(and(inArray(schema.sysTask.id, taskIds), eq(schema.sysTask.status, 'failed')))
    const reasons = failedTasks.map(t => t.errorMsg || '未知错误')
    throw new Error(`仍有 ${after.missing.length} 个分镜缺少视频（镜号 ${after.missing.join('、')}）${reasons.length ? `：${reasons[0]}` : ''}`)
  }
}

/** 装配单集全部步骤函数（供主循环窗口调度与输入回补使用） */
export function buildStepFns(ep: EpisodeRow, dramaId: number, run: ProductionRun, userId?: number): Record<StepKey, StepFn> {
  return {
    script_rewrite: () => stepScriptRewrite(ep, dramaId, userId),
    extract_assets: () => stepExtractAssets(ep, dramaId, run, userId),
    storyboard_split: () => stepStoryboardSplit(ep, dramaId, userId),
    video_prompts: () => stepVideoPrompts(ep, dramaId, run, userId),
    asset_images: () => stepAssetImages(ep, run),
    generate_videos: () => stepGenerateVideos(ep, dramaId, run),
  }
}
