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
 * 阿里云百炼 Token Plan（token-plan.cn-beijing.maas.aliyuncs.com）Adapter
 *
 * 套餐（Key 以 sk-sp- 开头）与按量付费的 Key / Base URL 完全隔离，协议族与按量付费一致：
 * - 文本：OpenAI Chat 兼容 → {站点根}/compatible-mode/v1/chat/completions（走 createOpenAI，不经本文件）
 * - 视频：DashScope 原生体 + X-DashScope-Async → {站点根}/api/v1/services/aigc/video-generation/video-synthesis
 * - 轮询：GET {站点根}/api/v1/tasks/{task_id}
 *
 * 套餐不提供图片服务：生图仍走按量付费百炼（provider=dashscope），
 * 因为套餐图片端点只支持同步调用（实测异步 text2image 回 403），不适合批量生产链路。
 *
 * 与按量付费的差异只有「站点根归一」：官方文档给的 Base URL 是文本用的 /compatible-mode/v1，
 * 而视频端点挂在站点根的 /api/v1 下，用户往往把同一串地址填进两类配置。
 * 请求体形状与响应解析完全一致，因此继承 DashScope Adapter，只覆写 URL 钩子。
 */
import type { AIConfig } from './types'
import { joinProviderUrl } from './url'
import { DashScopeVideoAdapter } from './dashscope'

/**
 * 把用户填的基址归一到 Token Plan 站点根：剥掉文本用的 /compatible-mode/v1 与 DashScope 的 /api/v1。
 * 归一后 joinProviderUrl 再补 /api/v1，避免用户直接粘文档里的完整 Base URL 时拼出双前缀 404。
 */
export function tokenPlanRoot(baseUrl: string): string {
  return (baseUrl || '').trim().replace(/\/+$/, '').replace(/\/(compatible-mode|api)\/v1$/i, '')
}

export class TokenPlanVideoAdapter extends DashScopeVideoAdapter {
  override provider = 'token-plan'

  protected override generateUrl(config: AIConfig): string {
    return joinProviderUrl(tokenPlanRoot(config.baseUrl), '/api/v1', '/services/aigc/video-generation/video-synthesis')
  }

  protected override pollUrl(config: AIConfig, taskId: string): string {
    return joinProviderUrl(tokenPlanRoot(config.baseUrl), '/api/v1', `/tasks/${taskId}`)
  }
}
