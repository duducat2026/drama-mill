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
 * 图片/视频生成任务提交入口（拆分自 generation.ts）：解析配置 → 创建 sys_task → 入队执行。
 * 「设置页单次生成测试」标记 configTest + noBalance：全链路禁止任何自动再来一次。
 */
import { getActiveConfig, getConfigById } from './ai.js'
import { assertAiCallEnabled } from './ai-switch.js'
import { logTaskPayload, logTaskStart } from '../utils/task-logger.js'
import { createTask } from './generation-queue.js'
import { taskLabel } from './generation-shared.js'
import type { TaskType } from './generation-shared.js'
import type { AIConfig } from './adapters/types'

interface GenerateImageParams {
  storyboardId?: number
  dramaId?: number
  sceneId?: number
  characterId?: number
  propId?: number
  prompt: string
  model?: string
  size?: string
  referenceImages?: string[]
  frameType?: string
  configId?: number
  userId?: number
}

interface GenerateVideoParams {
  storyboardId?: number
  dramaId?: number
  prompt: string
  model?: string
  referenceMode?: string
  imageUrl?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  referenceImageUrls?: string[]
  referenceVideoUrls?: string[]
  referenceAudioUrls?: string[]
  generateAudio?: boolean
  duration?: number
  aspectRatio?: string
  resolution?: string
  configId?: number
  userId?: number
  noBalance?: boolean
}

export async function generateImage(params: GenerateImageParams): Promise<number> {
  // 指定配置（集锁定）可能已停用/删除/厂商收敛，失效时回退到该用户当前启用配置，避免生成被旧引用卡死
  const config = params.configId
    ? (await getConfigById(params.configId)) ?? await getActiveConfig('image', params.userId)
    : await getActiveConfig('image', params.userId)
  if (!config) throw new Error('未配置图片模型，请先到「设置」页添加并启用 AI 服务')

  const id = await createTask('image', config, {
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    sceneId: params.sceneId,
    characterId: params.characterId,
    propId: params.propId,
    prompt: params.prompt,
    model: params.model || config.model,
    userId: params.userId,
  }, {
    size: params.size || '1920x1080',
    frameType: params.frameType,
    referenceImages: params.referenceImages,
  })

  logTaskStart('ImageTask', 'enqueue', {
    id,
    provider: config.provider,
    storyboardId: params.storyboardId,
    sceneId: params.sceneId,
    characterId: params.characterId,
    frameType: params.frameType,
    model: params.model || config.model,
  })
  logTaskPayload('ImageTask', 'enqueue params', {
    id,
    config: { provider: config.provider, model: config.model, baseUrl: config.baseUrl },
    params,
  })
  return id
}

export async function generateVideo(params: GenerateVideoParams): Promise<number> {
  // 指定配置（集锁定）可能已停用/删除/厂商收敛，失效时回退到该用户当前启用配置
  const config = params.configId
    ? (await getConfigById(params.configId)) ?? await getActiveConfig('video', params.userId)
    : await getActiveConfig('video', params.userId)
  if (!config) throw new Error('未配置视频模型，请先到「设置」页添加并启用 AI 服务')

  const id = await createTask('video', config, {
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    prompt: params.prompt,
    model: params.model || config.model,
    userId: params.userId,
  }, {
    referenceMode: params.referenceMode || 'reference',
    imageUrl: params.imageUrl,
    firstFrameUrl: params.firstFrameUrl,
    lastFrameUrl: params.lastFrameUrl,
    referenceImageUrls: params.referenceImageUrls,
    referenceVideoUrls: params.referenceVideoUrls,
    referenceAudioUrls: params.referenceAudioUrls,
    generateAudio: params.generateAudio === false ? 0 : 1,
    duration: params.duration || 5,
    aspectRatio: params.aspectRatio || '16:9',
    // 保留高分辨率档位透传（MiniMax 768P/2K），火山等适配器内部自行归并
    resolution: ['480p', '720p', '1080p', '2K'].includes(params.resolution || '') ? params.resolution : '720p',
    // 锁定模型（用户显式指定）：提交时跳过多模型分流，按任务落库模型直发（含自动重试链路）
    noBalance: params.noBalance ? true : undefined,
  })

  logTaskStart('VideoTask', 'enqueue', {
    id,
    provider: config.provider,
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    referenceMode: params.referenceMode || 'reference',
    duration: params.duration || 5,
  })
  logTaskPayload('VideoTask', 'enqueue params', {
    id,
    config: { provider: config.provider, model: config.model, baseUrl: config.baseUrl },
    params,
  })
  return id
}

/** 设置页单次生成测试：复用队列、落盘和计价，不关联项目、不分流模型。
 *  任务标记 configTest，全链路禁止任何「自动再来一次」：限流退避、配置故障回退、
 *  素材失效重排、绿网提示词自动修正重提、看门狗自动重提、人工重试全部不适用。 */
export async function generateConfigTest(type: TaskType, config: AIConfig, prompt: string, userId: number, referenceImageUrl?: string): Promise<number> {
  await assertAiCallEnabled(userId)
  return createTask(type, config, { prompt, model: config.model, userId }, {
    configTest: true,
    noBalance: true,
    size: '1024x1024',
    duration: 5,
    resolution: '720p',
    aspectRatio: '16:9',
    generateAudio: 0,
    referenceMode: 'reference',
    ...(/r2v/i.test(config.model)
      ? { referenceImageUrls: referenceImageUrl ? [referenceImageUrl] : [] }
      : { firstFrameUrl: referenceImageUrl }),
  })
}
