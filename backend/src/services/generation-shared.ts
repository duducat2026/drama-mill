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
 * 生成链路共享层（拆分自 generation.ts）：任务类型/标签、轮询节奏、测试任务标记与参数解析。
 * 仅依赖 db 与常量模块，任何 generation-* 模块均可安全 import（无回环）。
 */
import { schema } from '../db/index.js'
import { VIDEO_TASK_TIMEOUT_MS } from '../utils/rate-config.js'

export type TaskType = 'image' | 'video'

export type SysTaskRecord = typeof schema.sysTask.$inferSelect

export const taskLabel = (type: TaskType) => (type === 'image' ? 'ImageTask' : 'VideoTask')

// 轮询节奏：图片 5s×120（上限 10 分钟）；视频 10s 间隔，超过 30 分钟（VIDEO_TASK_TIMEOUT_MS）未完成即判失败
export const POLL_PROFILES: Record<TaskType, { attempts: number; intervalMs: number; maxDurationMs: number | null }> = {
  image: { attempts: 120, intervalMs: 5000, maxDurationMs: 600_000 },
  video: { attempts: Math.ceil(VIDEO_TASK_TIMEOUT_MS / 10_000), intervalMs: 10_000, maxDurationMs: VIDEO_TASK_TIMEOUT_MS },
}

/** 单次生成测试任务的墙钟上限（从创建起算）：测试不排队、不进看门狗，超时必须自证失败，
 *  否则上游长期 PENDING 会让设置页弹层无限转圈（图片轮询本无硬墙钟）。 */
export const CONFIG_TEST_MAX_MS = Math.max(60_000, Number(process.env.AI_CONFIG_TEST_MAX_MS || 20 * 60_000))

/** 任务参数是否为设置页单次生成测试（禁止被自动重排/自动重提/人工重试复活） */
export function isConfigTestParams(params: Record<string, any> | null | undefined): boolean {
  return !!params?.configTest
}

export function parseTaskParams(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) || {}
  } catch {
    return {}
  }
}
