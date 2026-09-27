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
 * 适配器路由表：AI 配置里的 provider 字符串 → 具体 Adapter 单例。
 * 图片与视频各一张表；查不到即抛错（宁可早失败，不静默走错厂商）。
 */
import { OpenAIImageAdapter } from './openai-image'
import { GeminiImageAdapter } from './gemini-image'
import { VolcEngineImageAdapter } from './volcengine-image'
import { VolcEngineVideoAdapter } from './volcengine-video'
import { MiniMaxVideoAdapter } from './minimax-video'
import { DashScopeImageAdapter, DashScopeVideoAdapter } from './dashscope'
import { ModelRouterImageAdapter, ModelRouterVideoAdapter } from './model-router'
import type { ImageProviderAdapter, VideoProviderAdapter } from './types'

/** 生图侧注册表（openai/gemini/volcengine/dashscope + 自建网关） */
export const imageAdapters: Record<string, ImageProviderAdapter> = {
  'model-router': new ModelRouterImageAdapter(),
  dashscope: new DashScopeImageAdapter(),
  gemini: new GeminiImageAdapter(),
  openai: new OpenAIImageAdapter(),
  volcengine: new VolcEngineImageAdapter(),
}

/** 生视频侧注册表（无 openai/gemini 系厂商） */
export const videoAdapters: Record<string, VideoProviderAdapter> = {
  'model-router': new ModelRouterVideoAdapter(),
  dashscope: new DashScopeVideoAdapter(),
  minimax: new MiniMaxVideoAdapter(),
  volcengine: new VolcEngineVideoAdapter(),
}

/** 图片侧取适配器；provider 小写归一后查表，未注册即拒 */
export function getImageAdapter(provider: string): ImageProviderAdapter {
  const hit = imageAdapters[provider.toLowerCase()]
  if (!hit) {
    throw new Error(`Unsupported image provider: ${provider}`)
  }
  return hit
}

/** 视频侧取适配器；同上策略 fail-closed */
export function getVideoAdapter(provider: string): VideoProviderAdapter {
  const hit = videoAdapters[provider.toLowerCase()]
  if (!hit) {
    throw new Error(`Unsupported video provider: ${provider}`)
  }
  return hit
}
