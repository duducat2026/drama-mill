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
 * 资产图片巡检看门狗 — 定期捞回生产中/中断项目里缺图的资产
 * 生产编排是进程内存态，暂停/重启/失败后可能留下缺图资产（任务失败或随进程丢失）；
 * 每 20 分钟（ASSET_WATCHDOG_INTERVAL_MS 可调）巡检一次：对缺图且无进行中图片任务的资产重提生成。
 * 提交统一走 generation 队列，受图片并发槽位/节奏闸门约束，不会击穿上游限额。
 * 补图属「后台替用户发起的付费调用」，受用户侧开关约束（users.asset_watchdog_enabled，默认关闭）。
 */
import { eq, and, isNull, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { batchGenerateCharacterImages, batchGenerateSceneImages, batchGeneratePropImages } from './asset-images.js'
import { getEpisodeAssets, getProductionRun } from './production.js'
import { ASSET_WATCHDOG_INTERVAL_MS, ASSET_WATCHDOG_MAX_RESUBMIT } from '../utils/rate-config.js'
import { isAbandonedTask } from './runtime-config.js'
import { isAiCallEnabled } from './ai-switch.js'
import { anyWatchdogEnabled, isWatchdogEnabled, watchdogConsentSql } from './watchdog-switch.js'
import { logTaskError, logTaskProgress, logTaskStart } from '../utils/task-logger.js'

const ACTIVE_TASK_STATUSES = ['processing', 'pending']

/** 巡检目标：生产中/失败的项目，以及未完成但已有分镜的中断项目（编排中途死掉、状态还停在 draft） */
async function findTargetDramas() {
  // 归属人已授权本看门狗的项目才进入候选（下推 SQL）：默认关闭时不做无意义的全库项目扫描
  const all = (await db.select().from(schema.dramas)
    .where(and(isNull(schema.dramas.deletedAt), watchdogConsentSql('asset', schema.dramas.userId))))
  const direct = all.filter(d => ['producing', 'failed'].includes(d.status || ''))
  const maybeInterrupted = all.filter(d => !['producing', 'failed', 'completed'].includes(d.status || ''))
  if (!maybeInterrupted.length) return direct

  // 中断判定：项目下任一集已有分镜（说明流水线走过拆分，但编排没有跑到终态）
  const eps = await db.select({ id: schema.episodes.id, dramaId: schema.episodes.dramaId }).from(schema.episodes)
    .where(and(inArray(schema.episodes.dramaId, maybeInterrupted.map(d => d.id)), isNull(schema.episodes.deletedAt)))
  const dramaIdsWithSb = new Set<number>()
  if (eps.length) {
    const sbs = await db.select({ episodeId: schema.storyboards.episodeId }).from(schema.storyboards)
      .where(and(inArray(schema.storyboards.episodeId, eps.map(e => e.id)), isNull(schema.storyboards.deletedAt)))
    const epWithSb = new Set(sbs.map(s => s.episodeId))
    for (const e of eps) if (epWithSb.has(e.id)) dramaIdsWithSb.add(e.dramaId)
  }
  return [...direct, ...maybeInterrupted.filter(d => dramaIdsWithSb.has(d.id))]
}

/** 已有进行中/排队图片任务的资产（避免重复提交）；已人工放弃的资产同样跳过，
 *  防止无法处理的资产被每轮巡检反复创建新任务 */
async function getBusyAssetIds(kind: 'characterId' | 'sceneId' | 'propId', ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set()
  const tasks = await db.select().from(schema.sysTask).where(and(
    eq(schema.sysTask.type, 'image'),
    inArray(schema.sysTask[kind], ids),
  ))
  return new Set(tasks
    .filter(t => ACTIVE_TASK_STATUSES.includes(t.status || '') || isAbandonedTask(t.retryCount))
    .map(t => t[kind]!))
}

/** 单轮巡检：返回重提数量 */
export async function runAssetWatchdogOnce(): Promise<number> {
  // 用户侧总闸：无人开启「缺图资产自动补生成」时整轮不取数（默认关闭，补图属后台替用户花钱）
  if (!await anyWatchdogEnabled('asset')) return 0
  const dramas = await findTargetDramas()
  // 内存中有活跃/暂停 run 的项目不碰：活跃 run 自带补跑，暂停是用户明确意图
  const targets = dramas.filter(d => {
    const run = getProductionRun(d.id)
    return !run || (run.status !== 'running' && run.status !== 'paused')
  })
  if (!targets.length) return 0

  let resubmitted = 0
  for (const drama of targets) {
    // 二次确认项目归属人已授权（候选已按 watchdogConsentSql 下推，此处防后续有人放宽取数条件）
    if (!await isWatchdogEnabled('asset', drama.userId)) continue
    // 项目归属人关闭了模型调用总开关：整个项目跳过，打开后下一轮巡检自然补跑
    if (!await isAiCallEnabled(drama.userId)) continue
    const episodes = await db.select().from(schema.episodes)
      .where(and(eq(schema.episodes.dramaId, drama.id), isNull(schema.episodes.deletedAt)))
    for (const ep of episodes) {
      if (resubmitted >= ASSET_WATCHDOG_MAX_RESUBMIT) break

      const { chars, scenes, props } = await getEpisodeAssets(ep.id)
      const noImageChars = chars.filter(c => !c.imageUrl)
      const noImageScenes = scenes.filter(s => !s.imageUrl)
      const noImageProps = props.filter(p => !p.imageUrl)
      if (!noImageChars.length && !noImageScenes.length && !noImageProps.length) continue

      // 只重提没有进行中任务的资产（失败/随重启丢失的都算待生成）
      const [busyChars, busyScenes, busyProps] = await Promise.all([
        getBusyAssetIds('characterId', noImageChars.map(c => c.id)),
        getBusyAssetIds('sceneId', noImageScenes.map(s => s.id)),
        getBusyAssetIds('propId', noImageProps.map(p => p.id)),
      ])
      const charIds = noImageChars.filter(c => !busyChars.has(c.id)).map(c => c.id)
      const sceneIds = noImageScenes.filter(s => !busyScenes.has(s.id)).map(s => s.id)
      const propIds = noImageProps.filter(p => !busyProps.has(p.id)).map(p => p.id)
      if (!charIds.length && !sceneIds.length && !propIds.length) continue

      const room = ASSET_WATCHDOG_MAX_RESUBMIT - resubmitted
      const pickedChars = charIds.slice(0, room)
      const pickedScenes = sceneIds.slice(0, room - pickedChars.length)
      const pickedProps = propIds.slice(0, room - pickedChars.length - pickedScenes.length)

      const results = [
        ...(await batchGenerateCharacterImages(ep.id, pickedChars)),
        ...(await batchGenerateSceneImages(ep.id, pickedScenes)),
        ...(await batchGeneratePropImages(ep.id, pickedProps)),
      ]
      resubmitted += results.length
      logTaskProgress('AssetWatchdog', 'resubmit', {
        dramaId: drama.id, episodeId: ep.id,
        chars: pickedChars.length, scenes: pickedScenes.length, props: pickedProps.length,
        started: results.length,
      })
    }
    if (resubmitted >= ASSET_WATCHDOG_MAX_RESUBMIT) break
  }
  return resubmitted
}

let timer: ReturnType<typeof setInterval> | null = null

/** 启动定时巡检：首轮延迟 60 秒（避开启动时恢复中断任务的窗口），之后按间隔循环 */
export function startAssetWatchdog() {
  if (timer) return
  setTimeout(() => {
    void sweep('first-run')
    timer = setInterval(() => void sweep('interval'), ASSET_WATCHDOG_INTERVAL_MS)
  }, 60_000)
  logTaskStart('AssetWatchdog', 'armed', { intervalMs: ASSET_WATCHDOG_INTERVAL_MS, maxResubmit: ASSET_WATCHDOG_MAX_RESUBMIT })
}

async function sweep(trigger: string) {
  try {
    const resubmitted = await runAssetWatchdogOnce()
    if (resubmitted > 0) logTaskProgress('AssetWatchdog', 'sweep-done', { trigger, resubmitted })
  } catch (err: any) {
    logTaskError('AssetWatchdog', 'sweep-error', { trigger, error: err?.message || String(err) })
  }
}
