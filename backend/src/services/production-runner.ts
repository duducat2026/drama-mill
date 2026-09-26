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
 * 自动化生产 — 编排主循环（启动预热 + 两阶段解耦多集滑动窗口并行）
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { PROD_EPISODE_CONCURRENCY, PROD_PRE_STORYBOARD_CONCURRENCY, PROD_PRE_VIDEO_CONCURRENCY } from '../utils/rate-config.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess, logTaskWarn } from '../utils/task-logger.js'
import {
  PAUSED, isPaused, PRODUCTION_STEPS,
  waitForVideoSlot, releaseVideoSlot,
  getDramaEpisodes, isEpisodeCompleted, setEpisodeStatus, setDramaStatus, ensureStepInputs,
  getActiveRun, setActiveRun, getDramaEpisodesLite,
  type EpisodeRow, type ProductionRun, type StepKey,
} from './production-shared.js'
import { buildStepFns } from './production-steps.js'

export { getDramaEpisodesLite }

/** 单集阶段1：前 5 步（剧本改写→资产图片），受 PROD_PRE_VIDEO_CONCURRENCY 窗口控制；
 *  完成后立即释放窗口槽位（移交视频阶段队列，见 runLoop），不让长达数小时的视频生成占着前置窗口 */
async function produceEpisodePreVideo(ep: EpisodeRow, dramaId: number, run: ProductionRun, userId?: number) {
  if (isPaused(run)) throw PAUSED
  await setEpisodeStatus(ep.id, 'producing')
  try {
    const stepFns = buildStepFns(ep, dramaId, run, userId)
    for (const { key } of PRODUCTION_STEPS) {
      if (key === 'generate_videos') break  // 视频生成阶段单独控速，不占前置窗口
      if (isPaused(run)) throw PAUSED
      run.current_step = key
      logTaskProgress('Production', 'step-start', { dramaId, episodeNumber: ep.episodeNumber, step: key })
      await ensureStepInputs(ep, dramaId, run, userId, key, stepFns)
      await stepFns[key]()
    }
  } catch (err: any) {
    if (err === PAUSED) throw err
    await setEpisodeStatus(ep.id, 'failed').catch(() => {})
    throw new Error(`第 ${ep.episodeNumber} 集前置步骤失败：${err?.message || '未知错误'}`)
  }
}

/** 单集阶段2：视频生成（受 PROD_EPISODE_CONCURRENCY 槽位限制），不占前置窗口；
 *  完成后标集级 completed；失败/暂停同阶段1 落状态后上抛 */
async function produceEpisodeVideoStage(ep: EpisodeRow, dramaId: number, run: ProductionRun, userId?: number) {
  try {
    await waitForVideoSlot(run)
    try {
      const stepFns = buildStepFns(ep, dramaId, run, userId)
      const key: StepKey = 'generate_videos'
      if (isPaused(run)) throw PAUSED
      run.current_step = key
      logTaskProgress('Production', 'step-start', { dramaId, episodeNumber: ep.episodeNumber, step: key })
      await ensureStepInputs(ep, dramaId, run, userId, key, stepFns)
      await stepFns[key]()
    } finally {
      releaseVideoSlot()
    }
    await setEpisodeStatus(ep.id, 'completed')
    logTaskProgress('Production', 'episode-done', { dramaId, episodeNumber: ep.episodeNumber })
  } catch (err: any) {
    if (err === PAUSED) throw err
    await setEpisodeStatus(ep.id, 'failed').catch(() => {})
    throw new Error(`第 ${ep.episodeNumber} 集视频生成失败：${err?.message || '未知错误'}`)
  }
}

/**
 * 启动预热：分镜拆分之前的步骤（剧本改写→资产提取）对所有集全量快速并行。
 * 窗口（PROD_PRE_VIDEO_CONCURRENCY）限制的是整条前置流水线，集多时后排集要等前排集
 * 跑完全链路才轮到，文本模型出现队列空等；预热阶段启动即把所有集的纯文本前置步骤打满，
 * 实际吞吐仍受 TEXT_AI_MAX_CONCURRENT 全局槽位约束。
 * 预热失败不中止整体（步骤幂等，主窗口 produceEpisodePreVideo 会经 ensureStepInputs 回补）；
 * 暂停经 PAUSED 向上传递（等在跑集到达检查点退出）。
 */
async function warmupPreStoryboard(list: EpisodeRow[], dramaId: number, run: ProductionRun, userId?: number) {
  let idx = 0
  const running = new Set<Promise<void>>()
  let fatalError: any = null

  // 外层条件带 !fatalError：暂停后停止补新，等 running 排空即退出（与 runLoop 同款防死循环逃逸）
  while ((!fatalError && idx < list.length) || running.size > 0) {
    while (!fatalError && running.size < Math.max(1, PROD_PRE_STORYBOARD_CONCURRENCY) && idx < list.length) {
      const ep = list[idx++]
      const stepFns = buildStepFns(ep, dramaId, run, userId)
      const p = (async () => {
        if (isPaused(run)) throw PAUSED
        await setEpisodeStatus(ep.id, 'producing')
        logTaskProgress('Production', 'warmup-start', { dramaId, episodeNumber: ep.episodeNumber })
        await stepFns.script_rewrite()
        if (isPaused(run)) throw PAUSED
        await stepFns.extract_assets()
        logTaskProgress('Production', 'warmup-done', { dramaId, episodeNumber: ep.episodeNumber })
      })()
        .catch((err: any) => {
          if (err === PAUSED) { if (!fatalError) fatalError = err; return }
          // 预热失败不终止项目：步骤幂等，主窗口会按 DB 状态回补重跑该集
          logTaskWarn('Production', 'warmup-failed', { dramaId, episodeNumber: ep.episodeNumber, error: err?.message || String(err) })
        })
        .finally(() => running.delete(p))
      running.add(p)
    }
    if (running.size > 0) await Promise.race(running)
  }
  if (fatalError) throw fatalError
}

export async function runLoop(dramaId: number, run: ProductionRun, fromEpisodeNumber?: number) {
  logTaskStart('Production', 'run', { dramaId, fromEpisodeNumber, preStoryboardConcurrency: PROD_PRE_STORYBOARD_CONCURRENCY, preVideoConcurrency: PROD_PRE_VIDEO_CONCURRENCY, videoConcurrency: PROD_EPISODE_CONCURRENCY })
  // 项目归属用户：文本链路配置/成本/耗时全部按该用户维度（重启续跑也不跨用户）
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  const userId = drama?.userId ?? undefined
  try {
    let list = await getDramaEpisodes(dramaId)
    if (fromEpisodeNumber) list = list.filter(e => e.episodeNumber >= fromEpisodeNumber)
    // 从第一个未完成集开始（按 DB 状态推导，天然断点续跑）
    for (let i = 0; i < list.length; i++) {
      if (!(await isEpisodeCompleted(list[i].id))) { list = list.slice(i); break }
      if (i === list.length - 1) list = []
    }
    if (!list.length) {
      run.status = 'done'
      run.finished_at = now()
      await setDramaStatus(dramaId, 'completed')
      logTaskSuccess('Production', 'run', { dramaId, note: '所有剧集已完成' })
      return
    }

    await setDramaStatus(dramaId, 'producing')

    // 启动预热：所有集的分镜前置步骤（剧本改写→资产提取）全量快速并行，防止队列空等；
    // 预热结果幂等落库，后续窗口内 produceEpisodePreVideo 的已完成步骤自动跳过
    await warmupPreStoryboard(list, dramaId, run, userId)
    if (isPaused(run)) throw PAUSED

    // 两阶段解耦窗口：前 5 步最多 PROD_PRE_VIDEO_CONCURRENCY 集并行推进，完成立即移交视频阶段队列释放槽位；
    // 视频阶段不占前置窗口（只受 PROD_EPISODE_CONCURRENCY 槽位约束），前置任务尽早铺满，
    // 非视频模型在视频生成期间持续工作；暂停/失败后停止补新，等在跑集到达检查点退出
    let idx = 0
    const running = new Set<Promise<void>>()      // 前置窗口（PROD_PRE_VIDEO_CONCURRENCY）
    const videoStage = new Set<Promise<void>>()   // 视频阶段（不占前置窗口，槽位由 waitForVideoSlot 控）
    let fatalError: any = null

    // 外层条件带 !fatalError：失败/暂停停止补新后，若两个集合均已排空必须立即退出，
    // 否则内层不启动、下方无 await，会退化为同步死循环独占事件循环（全服务冻结）
    while ((!fatalError && idx < list.length) || running.size > 0 || videoStage.size > 0) {
      while (!fatalError && running.size < Math.max(1, PROD_PRE_VIDEO_CONCURRENCY) && idx < list.length) {
        const ep = list[idx++]
        run.current_episode_id = ep.id
        run.current_episode_number = ep.episodeNumber
        const p = (async () => {
          await produceEpisodePreVideo(ep, dramaId, run, userId)
          // 前置完成即释放窗口槽位；已有致命错误/暂停时不再开新的视频阶段（快速收敛）
          if (fatalError || isPaused(run)) return
          const vp = produceEpisodeVideoStage(ep, dramaId, run, userId)
            .catch((err: any) => { if (!fatalError) fatalError = err })
            .finally(() => videoStage.delete(vp))
          videoStage.add(vp)
        })()
          .catch((err: any) => { if (!fatalError) fatalError = err })
          .finally(() => running.delete(p))
        running.add(p)
      }
      if (running.size > 0 || videoStage.size > 0) await Promise.race([...running, ...videoStage])
    }
    if (fatalError) throw fatalError

    run.status = 'done'
    run.finished_at = now()
    run.current_step = null
    await setDramaStatus(dramaId, 'completed')
    logTaskSuccess('Production', 'run', { dramaId, episodes: list.length })
  } catch (err: any) {
    if (err === PAUSED) {
      run.finished_at = now()
      logTaskProgress('Production', 'paused', { dramaId, episodeId: run.current_episode_id, step: run.current_step })
      return
    }
    run.status = 'error'
    run.error = err?.message || '生产失败'
    run.finished_at = now()
    await setDramaStatus(dramaId, 'failed').catch(() => {})
    logTaskError('Production', 'run', { dramaId, episodeId: run.current_episode_id, step: run.current_step, error: err?.message })
  }
}

// ─── 对外控制接口（经 production.ts 门面透出，外部 import 路径不变） ───

/** 启动自动生产（缺省从第一个未完成集开始） */
export function startProduction(dramaId: number, fromEpisodeNumber?: number) {
  const existing = getActiveRun(dramaId)
  if (existing?.status === 'running') return { started: false, already_running: true }
  const run: ProductionRun = {
    status: 'running',
    current_episode_id: null,
    current_episode_number: null,
    current_step: null,
    error: null,
    started_at: now(),
  }
  setActiveRun(dramaId, run)
  void runLoop(dramaId, run, fromEpisodeNumber)
  return { started: true }
}

/** 暂停：不中断正在跑的上游任务，仅在当前检查点（步骤间/轮询间隙）后停止 */
export function pauseProduction(dramaId: number) {
  const run = getActiveRun(dramaId)
  if (!run || run.status !== 'running') return false
  run.status = 'paused'
  return true
}

/**
 * 继续 / 失败重试：从第一个未完成集按 DB 状态推导剩余步骤（幂等，已完成步骤自动跳过）
 * - paused：正常暂停后续跑
 * - error：上次失败（如单个资产图失败）直接重试，不必整项目重来
 * - run 丢失（进程重启）：DB 状态为 producing/failed 时也可续跑；从未生产过的项目请走 start
 */
export async function resumeProduction(dramaId: number) {
  const run = getActiveRun(dramaId)
  if (run?.status === 'running' || run?.status === 'done') return false
  if (!run) {
    const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
    if (!drama || drama.deletedAt || !['producing', 'failed'].includes(drama.status || '')) return false
  }
  return startProduction(dramaId).started
}

export function getProductionRun(dramaId: number): ProductionRun | null {
  return getActiveRun(dramaId)
}
