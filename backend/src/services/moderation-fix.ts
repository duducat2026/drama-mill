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
 * 绿网（内容安全审核）拦截自动修正 —
 * 图片/视频生成任务因内容审核拦截失败时，用文本 AI 改写敏感提示词
 * （去除可能触发审核的表述、保持画面内容与叙事意图不变），回写任务后自动重提。
 *
 * 开关：按项目（dramas.metadata JSON 的 green_net_auto_fix 字段）控制，
 * 默认开启（字段缺失/无项目关联/解析失败均视为开启）。
 *
 * 终止条件：单任务累计修正次数达上限（GREEN_NET_FIX_MAX）后不再改写，
 * 保留失败状态留给人工处理，避免与上游审核无限对抗。
 */
import { Agent } from '@mastra/core/agent'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { getModel } from '../agents/index.js'
import { withTextSlot } from '../utils/rate-config.js'
import { resolveTextConfigMeta } from './ai.js'
import { recordTextUsageFromResult } from './cost.js'
import { retryTask } from './generation.js'
import { logTaskError, logTaskProgress, logTaskWarn } from '../utils/task-logger.js'
import { isModerationError as matchesModerationError } from '../utils/moderation.js'

/** 单任务绿网修正上限：达上限后不再自动改写（防无限对抗白耗文本配额） */
const GREEN_NET_FIX_MAX = Math.max(1, Number(process.env.GREEN_NET_FIX_MAX || 2))

/** 修正上限对外暴露（供提交前预检共用额度判断） */
export function getGreenNetFixMax(): number {
  return GREEN_NET_FIX_MAX
}

/**
 * 本地敏感词预检词表：命中则提交前先用文本 AI 改写，避免排队后才被上游绿网拦截白耗整轮等待。
 * 词表取高置信度拦截词（低误报）：上游审查未命中的漏网仍由失败后修正链路兜底。
 */
const SENSITIVE_TERMS = [
  // 血腥暴力类（含变体写法防绕过）
  '鲜血喷溅', '血肉模糊', '开膛破肚', '剖腹', '剥皮', '虐杀', '凌迟', '斩首示众', '血洗', '屠杀平民',
  // 色情暗示类（短剧常见擦边表述）
  '宽衣解带', '肌肤相亲', '衣衫尽褪', '欺身而上', '耳鬓厮磨间', '红帐', '圆房', '宠幸', '侍寝', '双修',
  // 违禁品/违法类
  '吸毒', '注射毒品', '制毒', '贩毒', '枪支买卖', '赌博网站', '自杀方式', '割腕', '跳楼自尽',
]

/** 提示词是否命中本地敏感词表（提交前预检用，命中即先改写再提交） */
export function hasSensitiveTerms(prompt: string | null | undefined): boolean {
  if (!prompt) return false
  return SENSITIVE_TERMS.some(term => prompt.includes(term))
}

/** 绿网拦截类错误识别：内容审核/敏感内容拦截（不含凭证无效、限流、超时等其它终态错误）
 *  关键词集合单一来源见 utils/moderation.ts —— 失败原因诊断走同一判定，避免两处词表漂移 */
export function isModerationError(msg: string | null | undefined): boolean {
  return matchesModerationError(msg)
}

/**
 * 音频侧绿网拦截识别：生成结果的音频（audio_sync 等）被审核拦截。
 * 音频由模型根据提示词合成，拦的是输出音频而非提示词文本，改写提示词效果有限；
 * 确定性恢复是关闭音频重提（无音轨片段合成环节自动降级重编码兼容）。
 */
export function isAudioModerationFailure(msg: string | null | undefined): boolean {
  if (!msg) return false
  return /audio[_\s-]?sync|check failed for audio|生成?音频.*(审核|拦截|违规|敏感)/i.test(msg)
}

/** 项目级开关：metadata.green_net_auto_fix 显式为 false 才关闭，其余情况默认开启 */
export async function isGreenNetFixEnabled(dramaId: number | null | undefined): Promise<boolean> {
  if (!dramaId) return true
  const [drama] = await db.select({ metadata: schema.dramas.metadata }).from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama?.metadata) return true
  try {
    return JSON.parse(drama.metadata)?.green_net_auto_fix !== false
  } catch {
    return true
  }
}

function parseJson(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 文本 AI 改写敏感提示词：只输出改写结果，去除围栏与首尾空白；返回原始 result 供成本计录；
 *  scene 区分触发来源（'failed'=失败后修正，'precheck'=提交前预检），仅影响提示词措辞 */
export async function rewritePromptForModeration(
  prompt: string, type: string, userId: number | null | undefined, scene: 'failed' | 'precheck' = 'failed',
): Promise<{ text: string; result: any } | null> {
  const model = await getModel(undefined, undefined, undefined, userId ?? null)
  const agent = new Agent({
    id: 'green-net-prompt-fix',
    name: 'green-net-prompt-fix',
    instructions: '你是提示词安全改写助手，负责改写被内容安全审核拦截的生成提示词。只输出改写后的提示词本身。',
    model,
  })
  const kind = type === 'image' ? '图片' : '视频'
  const lead = scene === 'precheck'
    ? `以下${kind}生成提示词可能触发内容安全审核（绿网），请提前改写它：`
    : `以下${kind}生成提示词被内容安全审核（绿网）拦截，请改写它：`
  const result = await withTextSlot(() => agent.generate(
    [{
      role: 'user',
      content: `${lead}
1. 保持画面内容、镜头语言与叙事意图不变；
2. 删除或替换可能触发审核的敏感词与描述（暴力血腥、色情暗示、涉政、违禁品、侵犯隐私等）；
3. 保持原提示词的语言与结构风格；
4. 只输出改写后的提示词本身，不要任何解释、前缀或引号。

原提示词：
${prompt}`,
    }],
    { maxSteps: 1 },
  ))
  const fixed = (result.text || '')
    .replace(/^```(?:\w+)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
  return fixed ? { text: fixed, result } : null
}

// 并发防重：同一任务的多次失败回调可能同时触发修正（轮询失败 + 看门狗），进程内去重
const fixingTaskIds = new Set<number>()

/**
 * 绿网拦截自动修正入口（由 failTask 在判定为内容审核类失败后异步调用）：
 * 校验项目开关与修正额度 → 文本 AI 改写提示词 → 回写任务 → 自动重提。
 * 任何环节失败都不抛出（仅日志），任务保留原失败状态等待人工处理。
 */
export async function attemptModerationAutoFix(taskId: number): Promise<void> {
  if (fixingTaskIds.has(taskId)) return
  fixingTaskIds.add(taskId)
  try {
    const [record] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, taskId))
    if (!record || record.status !== 'failed') return
    if (!isModerationError(record.errorMsg)) return
    if (!(await isGreenNetFixEnabled(record.dramaId))) {
      logTaskWarn('GreenNetFix', 'skip-project-disabled', { id: taskId, dramaId: record.dramaId })
      return
    }

    const params = parseJson(record.params)

    // 音频侧拦截的确定性恢复：关闭音频重提，天然绕开音频审核。
    // 不耗文本 AI、不占改写额度；audioFallback 标记保证只降级一次防循环，
    // 降级后若仍被拦（视频画面侧）则继续走下方提示词改写链路。
    if (record.type === 'video' && isAudioModerationFailure(record.errorMsg) && !params.audioFallback) {
      const nextParams = { ...params, generateAudio: 0, audioFallback: true }
      await db.update(schema.sysTask)
        .set({ params: JSON.stringify(nextParams), taskId: null, updatedAt: now() })
        .where(eq(schema.sysTask.id, taskId))
      logTaskProgress('GreenNetFix', 'audio-fallback-resubmitted', { id: taskId, dramaId: record.dramaId })
      await retryTask(taskId)
      return
    }

    if (!record.prompt?.trim()) {
      logTaskWarn('GreenNetFix', 'skip-no-prompt', { id: taskId })
      return
    }

    const fixCount = Number(params.moderationFixCount) || 0
    if (fixCount >= GREEN_NET_FIX_MAX) {
      logTaskWarn('GreenNetFix', 'exhausted', { id: taskId, fixCount, max: GREEN_NET_FIX_MAX })
      return
    }

    logTaskProgress('GreenNetFix', 'rewrite-start', { id: taskId, type: record.type, fixCount: fixCount + 1, dramaId: record.dramaId })
    const fixed = await rewritePromptForModeration(record.prompt, record.type, record.userId, 'failed')
    if (!fixed) {
      logTaskWarn('GreenNetFix', 'rewrite-empty', { id: taskId })
      return
    }

    // 改写调用计入成本（失败不影响修正流程）
    try {
      const meta = await resolveTextConfigMeta(record.userId)
      await recordTextUsageFromResult(fixed.result, meta, {
        userId: record.userId ?? null,
        dramaId: record.dramaId ?? null,
        detail: `green_net_fix#task${taskId}`,
      })
    } catch { /* 成本记录失败不阻断修正 */ }
    const fixedPrompt = fixed.text

    // 回写修正后的提示词与修正计数；清掉上游 task_id（上游已明确判失败，重提无需再探测旧任务）
    const nextParams = { ...params, moderationFixCount: fixCount + 1 }
    await db.update(schema.sysTask)
      .set({ prompt: fixedPrompt, params: JSON.stringify(nextParams), taskId: null, updatedAt: now() })
      .where(eq(schema.sysTask.id, taskId))
    logTaskProgress('GreenNetFix', 'rewrite-done', { id: taskId, fixCount: fixCount + 1, originalLen: record.prompt.length, fixedLen: fixedPrompt.length })

    await retryTask(taskId)
    logTaskProgress('GreenNetFix', 'resubmitted', { id: taskId, fixCount: fixCount + 1 })
  } catch (err: any) {
    logTaskError('GreenNetFix', 'fix-failed', { id: taskId, error: err?.message || String(err) })
  } finally {
    fixingTaskIds.delete(taskId)
  }
}
