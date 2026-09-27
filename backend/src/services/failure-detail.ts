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
 * 上游调用失败诊断门面 — 把各种来源的原始错误（AI SDK 包装层、fetch 系统错误、
 * 上游 JSON 错误体、落库的 error_msg 文本）归一为「一句结论 + 一条修复建议 + 原始信息」，
 * 供设置页生成测试与任务失败详情展示。
 *
 * 拆分：纯解析工具见 failure-detail-parse.ts，分类规则/服务商提示/结构类型见 failure-detail-rules.ts。
 * 本文件仅保留 describeFailure 编排，并对外再导出类型，保持既有 import 路径不变。
 */
import { isModerationError } from '../utils/moderation.js'
import { candidates, pickStatus, pickBodyFields, redact, truncate } from './failure-detail-parse.js'
import { MODERATION_RULE, RULES, providerHint, type FailureDetail } from './failure-detail-rules.js'

export type { FailureKind, FailureDetail } from './failure-detail-rules.js'

/**
 * 归一化一次失败：接受 Error / 字符串 / 任意对象，始终返回可直接渲染的结构。
 * ctx.serviceType / ctx.provider 用于追加与本服务商实际请求路径相关的提示。
 */
export function describeFailure(
  input: unknown,
  ctx?: { serviceType?: string | null; provider?: string | null },
): FailureDetail {
  const { parts, code: errCode } = typeof input === 'string' ? { parts: [input], code: '' } : candidates(input)
  const joined = parts.join('\n')
  const body = pickBodyFields(parts)
  // 上游 JSON 里的 error.message 常常才是人话，排在原文最前作为结论来源
  const haystack = [body.message, joined].filter(Boolean).join('\n')
  const status = pickStatus(typeof input === 'object' && input ? (input as any) : null, joined)
  const raw = truncate(redact(joined))

  const base: FailureDetail = {
    kind: 'unknown',
    summary: '',
    hint: '',
    upstream_status: status,
    upstream_code: body.code || (status === null ? errCode : ''),
    request_id: body.requestId,
    raw,
  }

  if (!joined.trim()) {
    return {
      ...base,
      kind: 'empty',
      summary: '上游未返回任何错误信息',
      hint: '多半是网关把错误响应吞掉了（返回空 body）。可先用「测试配置」探测端点连通性，再确认该网关是否按标准格式返回错误。',
    }
  }

  if (isModerationError(haystack)) {
    return { ...base, ...MODERATION_RULE, hint: `${MODERATION_RULE.hint}${providerHint(ctx?.serviceType, ctx?.provider)}` }
  }

  // 状态码统一追加到结论尾部，规则里不各写一份，避免「404 但文案是 400 的」这类自相矛盾
  const withStatus = (s: string) => (status !== null ? `${s}（HTTP ${status}）` : s)

  for (const rule of RULES) {
    const statusHit = !!rule.status && status !== null && rule.status(status)
    const textHit = !!rule.test && rule.test.test(haystack)
    if (!statusHit && !textHit) continue
    return { ...base, kind: rule.kind, summary: withStatus(rule.summary), hint: `${rule.hint}${providerHint(ctx?.serviceType, ctx?.provider)}` }
  }

  if (status !== null) {
    return {
      ...base,
      summary: body.message ? withStatus(body.message) : `上游返回 HTTP ${status}，但未给出错误说明`,
      hint: `${body.message ? '该状态码不在已知故障模式内，' : '多半是网关或 SDK 包装层吞掉了响应体，'}按下方原始返回定位；必要时把 request_id 交给服务商。${providerHint(ctx?.serviceType, ctx?.provider)}`,
    }
  }

  // 兜底：把最有信息量的一行当结论，避免前端只剩「生成失败」这种黑盒文案
  const firstLine = (body.message || joined).split('\n').map(s => s.trim()).find(Boolean) || ''
  return {
    ...base,
    summary: firstLine.slice(0, 200),
    hint: `按下方原始返回排查配置。${providerHint(ctx?.serviceType, ctx?.provider)}`,
  }
}
