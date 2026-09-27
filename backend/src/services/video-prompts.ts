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
 * 视频提示词批量生成
 * 给还没有 video_prompt 的分镜逐条跑 prompt_generator Agent，按集维护一份批任务。
 * 状态只存在进程内存里（重启即丢），批内每个分镜单独跟踪：pending/running/done/failed
 * 各带失败原因与重试次数，失败的分镜可以把原因回喂给 Agent 做针对性重试。
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

type StoryboardRow = (typeof schema.storyboards.$inferSelect)
type BatchOpts = { model?: string; configId?: number; userId?: number }

const tasks = new Map<number, VideoPromptBatchStatus>()

/** 按镜号升序取整集分镜 */
async function loadStoryboards(episodeId: number): Promise<StoryboardRow[]> {
  return db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .orderBy(schema.storyboards.storyboardNumber)
}

/** 视频模型标签：跟随该集锁定的视频配置，让 Agent 按目标模型的特性与时长限制来写 */
async function resolveVideoLabel(episodeId: number): Promise<string> {
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (!ep?.videoConfigId) return '默认'
  const [cfg] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, ep.videoConfigId))
  return cfg ? `${cfg.name} (${cfg.provider})` : '默认'
}

/** 拼装单个分镜的 Agent 指令；带 retryReason 时头部附上次的失败原因 */
function buildPromptMessage(sb: { id: number; storyboardNumber: number }, videoLabel: string, retryReason?: string): string {
  const base = `任务：给分镜 #${sb.storyboardNumber}(ID:${sb.id})创作视频提示词(video_prompt)。目标视频模型:${videoLabel},请按该模型的特性与时长限制来写。
第一步调用 read_storyboard_context，拿到该分镜的画面描述(含【镜头N】子镜头与台词/旁白)、氛围和时长；据此写出 video_prompt——每 3 秒一段换行，用 @角色名/@场景名/@道具名 引用参考素材；同一段内可以多镜头切镜，不同段之间允许换景别/角度/对象，但不得跨场景，切镜点要对齐分镜 description 里的【镜头N】结构。第二步调用 update_storyboard 把结果存回分镜 ID:${sb.id}，参数只给 storyboard_id 与 video_prompt 两个键，其余字段一律不要回传，也不要重新拆分整集。`
  if (!retryReason) return base
  return `【重试提示】上次生成失败，失败原因：${retryReason}。请根据此失败原因优化生成，确保这次能正确产出 video_prompt 并保存。\n\n${base}`
}

/** 后台跑批并挂接终态日志（fire-and-forget，立即返回） */
function launchBatch(
  episodeId: number, dramaId: number, opts: BatchOpts, task: VideoPromptBatchStatus,
  sbs: StoryboardRow[], items: VideoPromptBatchItem[], videoLabel: string, event: string,
) {
  runBatchLoop(episodeId, dramaId, opts, sbs, items, videoLabel)
    .then(() => {
      task.status = 'done'
      task.finished_at = new Date().toISOString()
      task.current_storyboard_id = undefined
      logTaskSuccess('VideoPrompt', event, { episodeId, total: task.total, completed: task.completed, failed: task.failed })
    })
    .catch((err: any) => {
      task.status = 'error'
      task.finished_at = new Date().toISOString()
      task.error = err?.message || '批量生成失败'
      logTaskError('VideoPrompt', event, { episodeId, error: err?.message })
    })
}

/** 批任务主循环：串行逐分镜调用 prompt_generator，成败以落库结果为准 */
async function runBatchLoop(
  episodeId: number,
  dramaId: number,
  opts: BatchOpts,
  sbs: StoryboardRow[],
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

  // 耗时打点包住整批：无论单条成败都归入 video_prompts 阶段
  return withTiming(episodeId, dramaId, 'video_prompts', async () => {
    for (let i = 0; i < sbs.length; i++) {
      const sb = sbs[i]
      const item = items[i]
      task.current_storyboard_id = sb.id
      item.status = 'running'
      logTaskProgress('VideoPrompt', 'batch-shot', { episodeId, storyboardId: sb.id, index: task.completed + task.failed + 1, total: task.total })
      try {
        // 文本 AI 并发闸门：多剧/多集并行生成时统一受 TEXT_AI_MAX_CONCURRENT 约束
        const result = await withTextSlot(() => agent.generate([{
          role: 'user',
          content: buildPromptMessage(sb, videoLabel, item.error),
        }], { maxSteps: 8, requestContext }))
        // 成本采集：一个分镜一次调用记一笔
        await recordTextUsageFromResult(result, costMeta, {
          userId: opts.userId, dramaId, episodeId, configId: costMeta?.configId, detail: `video_prompt#${sb.id}`,
        })
        // Agent 声称完成不算数，回库确认 video_prompt 非空才记成功
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

/** 启动批量生成（立即返回）；运行中返回 started:false,total:-1；无待生成分镜返回 started:false,total:0；
 *  传入 storyboardIds 时只处理所选分镜（即使已有提示词也重新生成），否则处理全部缺失提示词的分镜 */
export async function startVideoPromptBatch(
  episodeId: number,
  dramaId: number,
  opts: BatchOpts = {},
  storyboardIds?: number[],
): Promise<{ started: boolean; total: number }> {
  if (tasks.get(episodeId)?.status === 'running') return { started: false, total: -1 }

  const sbs = await loadStoryboards(episodeId)
  const pending = storyboardIds?.length
    ? sbs.filter(sb => storyboardIds.includes(sb.id))
    : sbs.filter(sb => !(sb.videoPrompt || '').trim())
  if (!pending.length) return { started: false, total: 0 }

  const videoLabel = await resolveVideoLabel(episodeId)
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
  launchBatch(episodeId, dramaId, opts, task, pending, items, videoLabel, 'batch')
  return { started: true, total: pending.length }
}

/** 重试失败的提示词分镜：只挑 status=failed 的 item，把失败原因回喂给 Agent 优化生成
 *  运行中返回 started:false；无失败分镜返回 started:false,total:0 */
export async function retryVideoPromptBatch(
  episodeId: number,
  dramaId: number,
  opts: BatchOpts = {},
  storyboardIds?: number[],
): Promise<{ started: boolean; total: number }> {
  if (tasks.get(episodeId)?.status === 'running') return { started: false, total: -1 }

  const task = tasks.get(episodeId)
  let targets: VideoPromptBatchItem[]
  let sbs: StoryboardRow[]

  if (task?.items?.length) {
    // 有历史批记录：从中挑出失败项（可按勾选范围再过滤）
    targets = task.items.filter(it =>
      it.status === 'failed' && (!storyboardIds?.length || storyboardIds.includes(it.storyboard_id)),
    )
    if (!targets.length) return { started: false, total: 0 }
    const ids = targets.map(it => it.storyboard_id)
    const all = await loadStoryboards(episodeId)
    sbs = all.filter(sb => ids.includes(sb.id))
  } else {
    // 内存里没有记录（如刚重启）：把仍缺提示词的分镜当作待重试对象
    const all = await loadStoryboards(episodeId)
    const missing = storyboardIds?.length
      ? all.filter(sb => storyboardIds.includes(sb.id) && !(sb.videoPrompt || '').trim())
      : all.filter(sb => !(sb.videoPrompt || '').trim())
    if (!missing.length) return { started: false, total: 0 }
    sbs = missing
    targets = missing.map(sb => ({
      storyboard_id: sb.id,
      storyboard_number: sb.storyboardNumber,
      title: sb.title || '',
      status: 'failed' as const,
      error: '尚无视频提示词',
      attempt: 0,
    }))
  }

  const videoLabel = await resolveVideoLabel(episodeId)

  // 待重试项复位为 pending 并累加尝试次数；error 留着当反馈原因
  const rowById = new Map(sbs.map(sb => [sb.id, sb]))
  const retryItems = targets.map(it => {
    const sb = rowById.get(it.storyboard_id)
    if (sb) {
      it.attempt++
      it.status = 'pending'
    }
    return it
  })
  // 处理顺序对齐 DB 的镜号顺序
  const retrySbs = retryItems
    .map(it => rowById.get(it.storyboard_id))
    .filter(Boolean) as StoryboardRow[]

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
  launchBatch(episodeId, dramaId, opts, newTask, retrySbs, retryItems, videoLabel, 'retry-batch')
  return { started: true, total: retrySbs.length }
}

export function getVideoPromptBatchStatus(episodeId: number): VideoPromptBatchStatus | null {
  return tasks.get(episodeId) ?? null
}
