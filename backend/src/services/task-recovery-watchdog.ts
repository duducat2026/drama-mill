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
 * 生成任务失败自动恢复看门狗 — 定期巡检两件事：
 * 1) 卡死判定：卡在 processing 超过 VIDEO_TASK_TIMEOUT_MS（默认 30 分钟）的视频任务判失败
 *    （轮询线程随重启/崩溃丢失的孤儿任务也能兜住）
 * 2) 自动重提：最近窗口期内失败的任务自动重新提交（复用原参数/原配置，走生成队列受并发槽位与节奏闸门约束）
 *    - 单任务自动重提有上限（retry_count 列计数，达上限留给人工处理；上限可在管理后台动态调整 0~9，
 *      见 services/runtime-config.ts，未配置时回退环境变量默认）
 *    - 内容审核拦截等终态错误不重提（重提也不会成功，白耗配额）
 *    - 人工放弃的任务（retry_count=99）永不重提
 *    - 生成测试任务（params.configTest）永不自动重提：测试语义是「一次调用」，重提等于重复计费
 *    - 自动重提受用户侧开关约束（users.retry_watchdog_enabled，默认关闭）；卡死判定属不碰模型的清理，不受该开关影响
 * 每 5 分钟（GEN_TASK_RECOVERY_INTERVAL_MS 可调）巡检一次。
 */
import {
  GEN_TASK_AUTO_RETRY_MAX,
  GEN_TASK_AUTO_RETRY_MAX_PER_SWEEP,
  GEN_TASK_RECOVERY_INTERVAL_MS,
  VIDEO_TASK_HARD_LIMIT_MS,
  VIDEO_TASK_TIMEOUT_MS,
} from '../utils/rate-config.js'
import { failTask, findStuckVideoTasks, getFailedTasksForAutoRetry, retryTask } from './generation.js'
import { isAiCallEnabled } from './ai-switch.js'
import { anyWatchdogEnabled, isWatchdogEnabled } from './watchdog-switch.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskWarn } from '../utils/task-logger.js'

/** 卡死任务判失败：updated_at 超过 2 倍超时阈值无更新（孤儿任务），
 *  或 created_at 超过硬性墙钟上限（上游永久 PENDING 导致无限轮询）。
 *  命中硬性墙钟的任务同步放弃（retry_count=99）——重提也必然失败，避免自动重试反复复活形成循环。 */
async function failStuckVideoTasksOnce(): Promise<number> {
  const stuck = await findStuckVideoTasks()
  for (const t of stuck) {
    const ageMin = t.createdAt ? Math.round((Date.now() - new Date(t.createdAt).getTime()) / 60_000) : 0
    const isHardLimit = ageMin >= Math.round(VIDEO_TASK_HARD_LIMIT_MS / 60_000)
    const reason = isHardLimit
      ? `硬性超时：任务运行 ${ageMin} 分钟，超过 ${Math.round(VIDEO_TASK_HARD_LIMIT_MS / 60_000)} 分钟墙钟上限，已强制判失败`
      : `视频生成超时：任务执行超过 ${Math.round(VIDEO_TASK_TIMEOUT_MS / 60_000)} 分钟未完成，已自动判定失败`
    await failTask(t.id, reason, { abandon: isHardLimit })
  }
  if (stuck.length) logTaskWarn('TaskRecovery', 'fail-stuck', { ids: stuck.map(t => t.id), timeoutMs: VIDEO_TASK_TIMEOUT_MS, hardLimitMs: VIDEO_TASK_HARD_LIMIT_MS })
  return stuck.length
}

/** 失败任务自动重提：满足冷却/窗口/限次条件的任务重新入队执行 */
async function autoRetryFailedTasksOnce(): Promise<number> {
  if (GEN_TASK_AUTO_RETRY_MAX <= 0) return 0
  // 用户侧总闸：无人开启「失败任务自动重提」时整轮不取数（默认关闭，自动重提属后台替用户花钱）
  if (!await anyWatchdogEnabled('retry')) return 0
  const targets = await getFailedTasksForAutoRetry(GEN_TASK_AUTO_RETRY_MAX_PER_SWEEP)
  let retried = 0
  for (const t of targets) {
    try {
      // 二次确认归属人已授权（取数已按 watchdogConsentSql 下推，此处防后续有人放宽候选条件）：
      // 跳过而非重提/判失败，不消耗重试额度、不写失败原因
      if (!await isWatchdogEnabled('retry', t.userId)) continue
      // 该用户关闭了模型调用总开关：本轮跳过（不消耗重试额度、不写失败原因），打开后下一轮自然续跑
      if (!await isAiCallEnabled(t.userId)) continue
      await retryTask(t.id, { auto: true })
      retried++
    } catch (err: any) {
      // 配置缺失/状态竞态等：跳过该任务，下一轮再评估
      logTaskWarn('TaskRecovery', 'auto-retry-skip', { id: t.id, error: err?.message || String(err) })
    }
  }
  if (retried) logTaskProgress('TaskRecovery', 'auto-retry', { retried, total: targets.length })
  return retried
}

/** 单轮巡检：先判卡死（卡死任务落为失败后可在后续轮次进入自动重提） */
export async function runTaskRecoveryOnce(): Promise<{ failedStuck: number; autoRetried: number }> {
  const failedStuck = await failStuckVideoTasksOnce()
  const autoRetried = await autoRetryFailedTasksOnce()
  return { failedStuck, autoRetried }
}

let timer: ReturnType<typeof setInterval> | null = null

/** 启动定时巡检：首轮延迟 45 秒（避开启动时恢复中断任务的窗口），之后按间隔循环 */
export function startTaskRecoveryWatchdog() {
  if (timer) return
  setTimeout(() => {
    void sweep('first-run')
    timer = setInterval(() => void sweep('interval'), GEN_TASK_RECOVERY_INTERVAL_MS)
  }, 45_000)
  logTaskStart('TaskRecovery', 'armed', {
    intervalMs: GEN_TASK_RECOVERY_INTERVAL_MS,
    videoTimeoutMs: VIDEO_TASK_TIMEOUT_MS,
    videoHardLimitMs: VIDEO_TASK_HARD_LIMIT_MS,
    autoRetryMax: GEN_TASK_AUTO_RETRY_MAX,
    maxPerSweep: GEN_TASK_AUTO_RETRY_MAX_PER_SWEEP,
  })
}

async function sweep(trigger: string) {
  try {
    const { failedStuck, autoRetried } = await runTaskRecoveryOnce()
    if (failedStuck || autoRetried) {
      logTaskProgress('TaskRecovery', 'sweep-done', { trigger, failedStuck, autoRetried })
    }
  } catch (err: any) {
    logTaskError('TaskRecovery', 'sweep-error', { trigger, error: err?.message || String(err) })
  }
}
