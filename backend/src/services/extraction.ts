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
 * 资产提取任务管理
 * 以「集 × 资产类型」为最小单元异步驱动 extractor Agent，角色/场景/道具各自独立
 * 起跑，同集三类可并行。任务状态只存进程内存：后端重启即丢失（彼时 Agent 调用
 * 也已中断），失败的任务可携带失败原因让 Agent 优化后重试。
 */
import { mastra } from '../mastra/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { withTiming } from '../utils/stage-timing.js'
import { withTextSlot } from '../utils/rate-config.js'
import { recordTextUsageFromResult } from './cost.js'
import { resolveTextConfigMeta } from './ai.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

export type ExtractTarget = 'characters' | 'scenes' | 'props'
export const EXTRACT_TARGETS: ExtractTarget[] = ['characters', 'scenes', 'props']

export interface ExtractTask {
  status: 'running' | 'done' | 'error'
  started_at: string
  finished_at?: string
  error?: string
  attempt: number
}

const tasks = new Map<string, ExtractTask>()
const taskKey = (episodeId: number, target: string) => `${episodeId}:${target}`

/** 分类型的提取指令：各自只碰一类资产，并要求先读已有数据做去重复用 */
const EXTRACT_MESSAGES: Record<ExtractTarget, string> = {
  characters: '请在剧本里提取全部角色（外貌描写要融入性格特征，并包含妆造细节）。动手前先调用 read_existing_characters 查看项目已有角色：同名或近名（带括号定位/别名的算近名，如「林小雨（主角）」与「林小雨」）一律复用已有条目、禁止重复创建；完成后调用 save_dedup_characters 保存。本次只提取角色，不要提取场景和道具。',
  scenes: '请在剧本里提取全部场景（写清地点、时间、光影等要素）。动手前先调用 read_existing_scenes 读取已有场景做去重，完成后调用 save_dedup_scenes 保存。本次只提取场景，不要提取角色和道具。',
  props: '请在剧本里提取关键道具——入选必须同时满足：① 直接推动剧情（它的出现/交接/损坏/发现会引发情节转折，如凶器、信物、关键文件、定情礼物、证据）；② 值得单独生成白底单品图（分镜会给它特写或反复出现）。判定三问只要有一问答"否"就放弃：删掉它剧情依然成立吗？它只是随手使用的日常物品（手机、筷子、水杯）吗？它是场景陈设（桌椅、灯具）吗？宁可少提不要多提，一集通常 0-3 个，超过 3 个只保留最重要的 3 个，没有就一个都不提取（save_dedup_props 传空数组）。description 只记录物品外貌。动手前先调用 read_existing_props 读取已有道具做去重，完成后调用 save_dedup_props 保存。本次只提取道具，不要提取角色和场景。',
}

/** 生成提取指令；带 retryReason 时在指令头部附加上次的失败原因 */
function buildExtractMessage(target: ExtractTarget, retryReason?: string): string {
  const base = EXTRACT_MESSAGES[target]
  if (!retryReason) return base
  return `【重试提示】上次提取失败，失败原因：${retryReason}。请根据此失败原因优化提取，确保这次能正确完成。\n\n${base}`
}

/** 把 Agent 单步进展转成日志：本步调了哪些工具、产出了什么文本 */
function logAgentStep(target: ExtractTarget, episodeId: number, step: any) {
  const called = (step?.toolCalls || [])
    .map((t: any) => t?.toolName || t?.payload?.toolName)
    .filter(Boolean)
  logTaskProgress('Extract', `${target}-step`, {
    episodeId,
    tools: called.length ? called.join(',') : undefined,
    text: (step?.text || '').slice(0, 200) || undefined,
  })
}

/** 发起 extractor Agent 调用并挂好成败回调（fire-and-forget，立即返回） */
function runExtractionAsync(
  episodeId: number, dramaId: number, target: ExtractTarget,
  opts: { model?: string; configId?: number; userId?: number },
  task: ExtractTask,
  message: string,
) {
  logTaskStart('Extract', target, { episodeId, dramaId, model: opts.model || undefined, configId: opts.configId || undefined, attempt: task.attempt })
  ;(async () => {
    const agent = mastra.getAgent('extractor')
    if (!agent) throw new Error('提取 Agent 不可用')
    return withTiming(episodeId, dramaId, `extract_${target}`, () => withTextSlot(() => agent.generate(
      [{ role: 'user', content: message }],
      {
        maxSteps: 20,
        requestContext: buildAgentRequestContext({
          episodeId,
          dramaId,
          modelOverride: opts.model || undefined,
          textConfigId: opts.configId || undefined,
          userId: opts.userId || undefined,
        }),
        onStepFinish: (step: any) => logAgentStep(target, episodeId, step),
      },
    )))
  })()
    // 耗时打点名：extract_characters / extract_scenes / extract_props；
    // 并发闸门：同集三类并行 + 跨集同时提取统一受 TEXT_AI_MAX_CONCURRENT 约束
    .then(async (result: any) => {
      task.status = 'done'
      task.finished_at = new Date().toISOString()
      task.error = undefined
      // 成本采集：按实际解析到的文本配置记账
      const meta = await resolveTextConfigMeta(opts.userId, opts.configId)
      await recordTextUsageFromResult(result, meta, {
        userId: opts.userId, dramaId, episodeId, configId: meta?.configId, detail: `extract_${target}`,
      })
      logTaskSuccess('Extract', target, {
        episodeId,
        steps: result?.steps?.length,
        toolCalls: (result?.toolCalls || []).map((t: any) => t?.toolName).filter(Boolean).join(',') || undefined,
        reply: (result?.text || '').slice(0, 300) || undefined,
      })
    })
    .catch((err: any) => {
      task.status = 'error'
      task.finished_at = new Date().toISOString()
      task.error = err?.message || '提取失败'
      logTaskError('Extract', target, { episodeId, error: err?.message, attempt: task.attempt })
    })
}

/** 启动异步提取任务（立即返回）；同集同类型已在运行时返回 false；可指定文本模型覆盖 */
export function startExtraction(episodeId: number, dramaId: number, target: ExtractTarget, opts: { model?: string; configId?: number; userId?: number } = {}): boolean {
  const key = taskKey(episodeId, target)
  if (tasks.get(key)?.status === 'running') return false

  const task: ExtractTask = { status: 'running', started_at: new Date().toISOString(), attempt: 1 }
  tasks.set(key, task)
  runExtractionAsync(episodeId, dramaId, target, opts, task, buildExtractMessage(target))
  return true
}

/** 重试失败的提取任务：把上次失败原因喂回给 Agent 指导优化
 *  运行中返回 false；无失败记录返回 false */
export function retryExtraction(episodeId: number, dramaId: number, target: ExtractTarget, opts: { model?: string; configId?: number; userId?: number } = {}): boolean {
  const key = taskKey(episodeId, target)
  const existing = tasks.get(key)
  if (existing?.status === 'running') return false
  // 只允许重放失败过的任务
  if (!existing || existing.status !== 'error') return false

  const retryReason = existing.error || '未知错误'
  existing.status = 'running'
  existing.started_at = new Date().toISOString()
  existing.finished_at = undefined
  existing.attempt = (existing.attempt || 1) + 1
  // error 字段暂不抹掉，runExtractionAsync 成功回调里才会清除
  runExtractionAsync(episodeId, dramaId, target, opts, existing, buildExtractMessage(target, retryReason))
  return true
}

/** 查询某集三类资产的提取任务状态（未启动过的类型为 null） */
export function getExtractionStatus(episodeId: number): Record<ExtractTarget, ExtractTask | null> {
  const status = {} as Record<ExtractTarget, ExtractTask | null>
  for (const target of EXTRACT_TARGETS) {
    status[target] = tasks.get(taskKey(episodeId, target)) ?? null
  }
  return status
}
