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
 * Model Router（model-router.edu-aliyun.com）Adapter
 *
 * 该网关按能力分协议（手册 + 实测）：
 * - 文本：OpenAI Chat 兼容 → POST /v1/chat/completions（走 createOpenAI，无需用到本文件）
 * - 图片：DashScope 兼容体 → POST /v1/images/generations（同步，output.choices[].message.content[].image）
 * - 视频：DashScope 兼容体 + 异步头 X-MR-Async: true → POST /v1/videos/generations
 * - 轮询：GET /v1/tasks/{task_id}
 *
 * 与原生百炼的差异只有「端点前缀 + 异步头 + 模型标识需带 symbol/ 前缀」，
 * 请求体形状与响应解析完全一致，因此直接继承 DashScope Adapter，只覆写 URL/头钩子。
 */
import type { AIConfig } from './types'
import { joinProviderUrl } from './url'
import { DashScopeImageAdapter, DashScopeVideoAdapter, syncHeaders } from './dashscope'

/** 网关统一挂在 /v1 下（不是百炼的 /api/v1） */
const MR_PREFIX = '/v1'
/** 异步任务开关：网关用 X-MR-Async，而不是百炼的 X-DashScope-Async */
const MR_ASYNC_HEADER = { 'X-MR-Async': 'true' } as const

export class ModelRouterImageAdapter extends DashScopeImageAdapter {
  override provider = 'model-router'

  protected override generateUrl(config: AIConfig): string {
    return joinProviderUrl(config.baseUrl, MR_PREFIX, '/images/generations')
  }

  protected override pollUrl(config: AIConfig, taskId: string): string {
    return joinProviderUrl(config.baseUrl, MR_PREFIX, `/tasks/${taskId}`)
  }

  /**
   * 网关图片为同步端点（手册「千问系列（同步）」），没有百炼那个独立的
   * text2image 异步端点，走父类试探只会换来 404，因此直接关闭。
   */
  protected override supportsAsyncImage(): boolean {
    return false
  }

  protected override defaultImageModel(): string {
    return 'qwen/wan2.7-image'
  }
}

export class ModelRouterVideoAdapter extends DashScopeVideoAdapter {
  override provider = 'model-router'

  protected override generateUrl(config: AIConfig): string {
    return joinProviderUrl(config.baseUrl, MR_PREFIX, '/videos/generations')
  }

  protected override pollUrl(config: AIConfig, taskId: string): string {
    return joinProviderUrl(config.baseUrl, MR_PREFIX, `/tasks/${taskId}`)
  }

  protected override submitHeaders(apiKey: string): Record<string, string> {
    return { ...syncHeaders(apiKey), ...MR_ASYNC_HEADER }
  }

  protected override defaultVideoModel(): string {
    return 'qwen/wan3.0-video'
  }
}
