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
 * AI 服务「极简生成测试」— 用已保存的配置真实发起一次最小生成，验证模型可用而不只是端点连通：
 * - 文本：同步调用一次最小对话，直接回传结果与耗时（走文本槽位与成本计价）
 * - 图片 / 视频：提交一次性生成任务（无项目关联、锁定本配置模型），返回任务 id 供前端轮询
 * 三类均遵循「模型调用总开关」（经 getConfigById / generateConfigTest 内部校验拦截）。
 */
import { Agent } from '@mastra/core/agent'
import { createTextModel } from '../agents/index.js'
import { withTextSlot } from '../utils/rate-config.js'
import { getConfigById } from './ai.js'
import { recordTextUsageFromResult } from './cost.js'
import { generateConfigTest } from './generation.js'

/** 各类型最小测试提示词：短、无敏感词、结果可肉眼判定 */
export const GENERATE_TEST_PROMPTS = {
  text: '为链路连通性测试，请只回复两个字：正常',
  image: '一只戴着宇航头盔的橘猫，纯色浅灰背景，细节清晰（生成链路测试图）',
  video: '一只戴着宇航头盔的橘猫在太空中缓缓转头，星空背景，镜头稳定（生成链路测试）',
} as const

/** 文本生成测试的输出上限：给到 256 而不是极小值 —— 思考型模型会把额度花在
 *  reasoning_content 上，上限太小会出现「调用成功但正文为空」（实测网关 max_tokens=1 时正文即空串） */
export const TEXT_TEST_MAX_TOKENS = 256

/** 文本生成测试：指定配置真实跑一次最小对话，返回结果文本与耗时；配置无效/未启用则抛错 */
export async function runTextGenerationTest(configId: number, userId: number) {
  const config = await getConfigById(configId)
  if (!config) throw new Error('该文本配置未启用或不可用，请先在设置页启用后再测试')
  const started = Date.now()
  // 上限受控在 TEXT_TEST_MAX_TOKENS：测试只需几个字，同时保证思考型模型也留得出正文
  const model = createTextModel(config, config.model, TEXT_TEST_MAX_TOKENS)
  const agent = new Agent({
    id: 'ai-config-text-test',
    name: 'ai-config-text-test',
    instructions: '你是链路测试助手，严格按用户要求极简作答，不要解释。',
    model,
  })
  const result = await withTextSlot(() => agent.generate(
    [{ role: 'user', content: GENERATE_TEST_PROMPTS.text }],
    { maxSteps: 1 },
  ))
  const elapsedMs = Date.now() - started
  // 成本归属到本人配置（detail 标记为生成测试），失败不阻断测试结果
  await recordTextUsageFromResult(
    result,
    { provider: config.provider, model: config.model },
    { userId, configId, detail: `config-test#${configId}` },
  ).catch(() => {})
  return {
    service_type: 'text',
    model: config.model,
    text: (result.text || '').trim(),
    elapsed_ms: elapsedMs,
    // 上游 200 却没正文时给一句可行动的解释，避免前端只剩一个空框让人以为「没测出来」
    empty_note: (result.text || '').trim() ? ''
      : '上游已正常响应，但正文字段为空：该模型把内容放在了 reasoning_content（思考过程）里，或输出上限被思考耗尽。可在「模型」列表里换成非思考型模型，或调高后端 AI_MAX_TOKENS 后重测。',
  }
}

/** 图片 / 视频生成测试：提交一次性任务，返回任务 id（前端轮询 /tasks/:id 取产物） */
export async function submitMediaGenerationTest(type: 'image' | 'video', configId: number, userId: number) {
  const config = await getConfigById(configId)
  if (!config) throw new Error(`该${type === 'image' ? '图片' : '视频'}配置未启用或不可用，请先在设置页启用后再测试`)
  const taskId = await generateConfigTest(type, config, GENERATE_TEST_PROMPTS[type], userId)
  return { service_type: type, model: config.model, task_id: taskId }
}
