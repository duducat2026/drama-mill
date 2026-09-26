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
 * 批量视频提示词任务 — 异步为缺少 video_prompt 的分镜逐个运行 prompt_generator Agent
 * 进程内内存态：按集跟踪一份任务，运行中不重复启动；重启后状态丢失
 * 支持每个分镜的独立状态跟踪（pending/running/done/failed + error + attempt），
 * 失败分镜可基于反馈的失败原因进行优化重试
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { mastra } from '../mastra/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { withTiming } from '../utils/stage-timing.js'
import { withTextSlot } from '../utils/rate-config.js'
import { recordTextUsageFromResult } from './cost.js'
import { resolveTextConfigMeta } from './ai.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

export interface VideoPromptBatchItem {
  storyboard_id: number
  storyboard_number: number
  title: string
  status: 'pending' | 'running' | 'done' | 'failed'
  error?: string
  attempt: number
}

export interface VideoPromptBatchStatus {
  status: 'running' | 'done' | 'error'
  total: number
  completed: number
  failed: number
  current_storyboard_id?: number
  started_at: string
  finished_at?: string
  error?: string
  items: VideoPromptBatchItem[]
}

const tasks = new Map<number, VideoPromptBatchStatus>()

/** 构造单次分镜提示词生成的 Agent 消息；retryReason 非空时追加失败原因供 Agent 优化 */
function buildPromptMessage(sb: { id: number; storyboardNumber: number }, videoLabel: string, retryReason?: string): string {
  const base = `请为分镜 #${sb.storyboardNumber}(ID:${sb.id})生成视频提示词(video_prompt)。视频模型:${videoLabel},请根据该模型的特性和时长限制生成。
请先调用 read_storyboard_context 获取该分镜的画面描述(含【镜头N】子镜头与台词/旁白)、氛围及时长，据此生成 video_prompt(按 3 秒分段换行、用 @角色名/@场景名/@道具名 引用参考素材；段落内允许多镜头切镜，段与段可以是不同景别/角度/对象，但不跨场景，切镜点对齐分镜 description 的【镜头N】结构),然后调用 update_storyboard 保存到分镜 ID:${sb.id}。update_storyboard 参数只传 storyboard_id 和 video_prompt 两个键,不要回传该分镜的其他任何字段,不要重新拆分整集。`
  if (!retryReason) return base
  return `【重试提示】上次生成失败，失败原因：${retryReason}。请根据此失败原因优化生成，确保这次能正确产出 video_prompt 并保存。\n\n${base}`
}

/** 启动批量生成（立即返回）；运行中返回 started:false,total:-1；无待生成分镜返回 started:false,total:0；
 *  传入 storyboardIds 时只处理所选分镜（即使已有提示词也重新生成），否则处理全部缺失提示词的分镜 */
export async function startVideoPromptBatch(
  episodeId: number,
  dramaId: number,
  opts: { model?: string; configId?: number; userId?: number } = {},
  storyboardIds?: number[],
): Promise<{ started: boolean; total: number }> {
  if (tasks.get(episodeId)?.status === 'running') return { started: false, total: -1 }

  const sbs = await db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .orderBy(schema.storyboards.storyboardNumber)
  const pending = storyboardIds?.length
    ? sbs.filter(sb => storyboardIds.includes(sb.id))
    : sbs.filter(sb => !(sb.videoPrompt || '').trim())
  if (!pending.length) return { started: false, total: 0 }

  // 视频模型标签：跟随该集锁定的视频配置，供 Agent 按模型特性生成
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  let videoLabel = '默认'
  if (ep?.videoConfigId) {
    const [cfg] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, ep.videoConfigId))
    if (cfg) videoLabel = `${cfg.name} (${cfg.provider})`
  }

  const items: VideoPromptBatchItem[] = pending.map(sb => ({
    storyboard_id: sb.id,
    storyboard_number: sb.storyboardNumber,
    title: sb.title || '',
    status: 'pending',
    attempt: 1,
  }))

  const task: VideoPromptBatchStatus = {
    status: 'running',
    total: pending.length,
    completed: 0,
    failed: 0,
    started_at: new Date().toISOString(),
    items,
  }
  tasks.set(episodeId, task)

  logTaskStart('VideoPrompt', 'batch', { episodeId, dramaId, total: pending.length, model: opts.model || undefined })
  runBatchLoop(episodeId, dramaId, opts, pending, items, videoLabel)
    .then(() => {
      task.status = 'done'
      task.finished_at = new Date().toISOString()
      task.current_storyboard_id = undefined
      logTaskSuccess('VideoPrompt', 'batch', { episodeId, total: task.total, completed: task.completed, failed: task.failed })
    })
    .catch((err: any) => {
      task.status = 'error'
      task.finished_at = new Date().toISOString()
      task.error = err?.message || '批量生成失败'
      logTaskError('VideoPrompt', 'batch', { episodeId, error: err?.message })
    })
  return { started: true, total: pending.length }
}

/** 批量生成主循环：逐个分镜调用 prompt_generator，更新 item 状态 */
async function runBatchLoop(
  episodeId: number,
  dramaId: number,
  opts: { model?: string; configId?: number; userId?: number },
  sbs: (typeof schema.storyboards.$inferSelect)[],
  items: VideoPromptBatchItem[],
  videoLabel: string,
): Promise<void> {
  const agent = mastra.getAgent('prompt_generator')
  if (!agent) throw new Error('视频提示词 Agent 不可用')
  const requestContext = buildAgentRequestContext({
    episodeId,
    dramaId,
    modelOverride: opts.model || undefined,
    textConfigId: opts.configId || undefined,
    userId: opts.userId || undefined,
  })
  const costMeta = await resolveTextConfigMeta(opts.userId, opts.configId)
  const task = tasks.get(episodeId)!

  // 耗时打点：整批包裹，成功/失败都落 video_prompts 阶段
  return withTiming(episodeId, dramaId, 'video_prompts', async () => {
    for (let i = 0; i < sbs.length; i++) {
      const sb = sbs[i]
      const item = items[i]
      task.current_storyboard_id = sb.id
      item.status = 'running'
      logTaskProgress('VideoPrompt', 'batch-shot', { episodeId, storyboardId: sb.id, index: task.completed + task.failed + 1, total: task.total })
      try {
        // 文本 AI 并发闸门：多剧/多集同时生成时受 TEXT_AI_MAX_CONCURRENT 约束
        const result = await withTextSlot(() => agent.generate([{
          role: 'user',
          content: buildPromptMessage(sb, videoLabel, item.error),
        }], { maxSteps: 8, requestContext }))
        // 成本采集：每个分镜一次调用记一条
        await recordTextUsageFromResult(result, costMeta, {
          userId: opts.userId, dramaId, episodeId, configId: costMeta?.configId, detail: `video_prompt#${sb.id}`,
        })
        // 以实际落库为准判定成败
        const [fresh] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, sb.id))
        if ((fresh?.videoPrompt || '').trim()) {
          task.completed++
          item.status = 'done'
          item.error = undefined
        } else {
          task.failed++
          item.status = 'failed'
          item.error = 'agent 完成但 video_prompt 为空，可能未正确调用 update_storyboard'
          logTaskError('VideoPrompt', 'batch-shot', { storyboardId: sb.id, error: item.error })
        }
      } catch (err: any) {
        task.failed++
        item.status = 'failed'
        item.error = err?.message || '未知错误'
        logTaskError('VideoPrompt', 'batch-shot', { storyboardId: sb.id, error: err?.message })
      }
    }
  })
}

/** 重试失败的提示词分镜：只处理 status=failed 的 item，将失败原因作为反馈传给 Agent 优化生成
 *  运行中返回 started:false；无失败分镜返回 started:false,total:0 */
export async function retryVideoPromptBatch(
  episodeId: number,
  dramaId: number,
  opts: { model?: string; configId?: number; userId?: number } = {},
  storyboardIds?: number[],
): Promise<{ started: boolean; total: number }> {
  if (tasks.get(episodeId)?.status === 'running') return { started: false, total: -1 }

  const task = tasks.get(episodeId)
  // 优先使用已存任务中的失败 item；无任务记录时从 DB 查缺失提示词的分镜
  let failedItems: VideoPromptBatchItem[]
  let sbs: (typeof schema.storyboards.$inferSelect)[]

  if (task?.items?.length) {
    failedItems = task.items.filter(it =>
      it.status === 'failed' && (!storyboardIds?.length || storyboardIds.includes(it.storyboard_id)),
    )
    if (!failedItems.length) return { started: false, total: 0 }
    const ids = failedItems.map(it => it.storyboard_id)
    const allSbs = await db.select().from(schema.storyboards)
      .where(eq(schema.storyboards.episodeId, episodeId))
      .orderBy(schema.storyboards.storyboardNumber)
    sbs = allSbs.filter(sb => ids.includes(sb.id))
  } else {
    // 无历史任务记录：直接查缺失提示词的分镜作为待重试
    const allSbs = await db.select().from(schema.storyboards)
      .where(eq(schema.storyboards.episodeId, episodeId))
      .orderBy(schema.storyboards.storyboardNumber)
    const pending = storyboardIds?.length
      ? allSbs.filter(sb => storyboardIds.includes(sb.id) && !(sb.videoPrompt || '').trim())
      : allSbs.filter(sb => !(sb.videoPrompt || '').trim())
    if (!pending.length) return { started: false, total: 0 }
    sbs = pending
    failedItems = pending.map(sb => ({
      storyboard_id: sb.id,
      storyboard_number: sb.storyboardNumber,
      title: sb.title || '',
      status: 'failed' as const,
      error: '尚无视频提示词',
      attempt: 0,
    }))
  }

  // 视频模型标签
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  let videoLabel = '默认'
  if (ep?.videoConfigId) {
    const [cfg] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, ep.videoConfigId))
    if (cfg) videoLabel = `${cfg.name} (${cfg.provider})`
  }

  // 重置失败 item 状态为 pending，递增 attempt
  const sbMap = new Map(sbs.map(sb => [sb.id, sb]))
  const retryItems = failedItems.map(it => {
    const sb = sbMap.get(it.storyboard_id)
    if (sb) {
      it.attempt++
      it.status = 'pending'
      // 保留 it.error 作为反馈原因，runBatchLoop 读取后会传入 Agent
    }
    return it
  })
  // 按 DB 顺序重排待处理分镜
  const retrySbs = retryItems
    .map(it => sbMap.get(it.storyboard_id))
    .filter(Boolean) as (typeof schema.storyboards.$inferSelect)[]

  const newTask: VideoPromptBatchStatus = {
    status: 'running',
    total: retrySbs.length,
    completed: 0,
    failed: 0,
    started_at: new Date().toISOString(),
    items: retryItems,
  }
  tasks.set(episodeId, newTask)

  logTaskStart('VideoPrompt', 'retry-batch', { episodeId, dramaId, total: retrySbs.length, model: opts.model || undefined })
  runBatchLoop(episodeId, dramaId, opts, retrySbs, retryItems, videoLabel)
    .then(() => {
      newTask.status = 'done'
      newTask.finished_at = new Date().toISOString()
      newTask.current_storyboard_id = undefined
      logTaskSuccess('VideoPrompt', 'retry-batch', { episodeId, total: newTask.total, completed: newTask.completed, failed: newTask.failed })
    })
    .catch((err: any) => {
      newTask.status = 'error'
      newTask.finished_at = new Date().toISOString()
      newTask.error = err?.message || '重试失败'
      logTaskError('VideoPrompt', 'retry-batch', { episodeId, error: err?.message })
    })
  return { started: true, total: retrySbs.length }
}

export function getVideoPromptBatchStatus(episodeId: number): VideoPromptBatchStatus | null {
  return tasks.get(episodeId) || null
}
