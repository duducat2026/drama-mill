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
 * 运行时动态配置 — 管理后台在线修改、持久化到 sys_config 键值表，无需重启即时生效。
 * 与 rate-config.ts（环境变量、改 .env 重启生效）互补：这里放需要运营侧随时可调的参数。
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { GEN_TASK_AUTO_RETRY_MAX } from '../utils/rate-config.js'
import { now } from '../utils/response.js'

/** 单任务失败自动重提上限的硬上限：管理后台可配置范围为 0~9（0 = 关闭自动恢复） */
export const AUTO_RETRY_HARD_MAX = 9

/** 放弃标记：任务被人工放弃时 retry_count 置为该值，自动重提/手动重试/资产补跑一律跳过
 *  （与迁移安抚防双重计费的用法一致：远高于任何重试上限即天然出局） */
export const ABANDONED_RETRY_COUNT = 99

const KEY_AUTO_RETRY_MAX = 'gen_task_auto_retry_max'

async function readConfigInt(key: string): Promise<number | null> {
  try {
    const [row] = await db.select().from(schema.sysConfig).where(eq(schema.sysConfig.configKey, key))
    if (!row?.configValue) return null
    const v = Number(row.configValue)
    return Number.isFinite(v) ? Math.floor(v) : null
  } catch {
    // 建表未完成等极端情况：回退环境变量默认
    return null
  }
}

/** 当前失败任务自动重提上限：运行时配置优先，缺省回退环境变量；统一夹到 0~9 */
export async function getAutoRetryMax(): Promise<number> {
  const stored = await readConfigInt(KEY_AUTO_RETRY_MAX)
  const v = stored ?? GEN_TASK_AUTO_RETRY_MAX
  return Math.max(0, Math.min(AUTO_RETRY_HARD_MAX, v))
}

/** 设置失败任务自动重提上限：仅接受 0~9 整数，主键冲突走 upsert */
export async function setAutoRetryMax(value: unknown): Promise<number> {
  const v = Number(value)
  if (!Number.isFinite(v) || Math.floor(v) !== v || v < 0 || v > AUTO_RETRY_HARD_MAX) {
    throw new Error(`重试上限须为 0~${AUTO_RETRY_HARD_MAX} 的整数（0 = 关闭自动恢复）`)
  }
  await db.insert(schema.sysConfig)
    .values({ configKey: KEY_AUTO_RETRY_MAX, configValue: String(v), updatedAt: now() })
    .onDuplicateKeyUpdate({ set: { configValue: String(v), updatedAt: now() } })
  return v
}

/** 任务是否已被人工放弃（重试计数达放弃标记） */
export function isAbandonedTask(retryCount: number | null | undefined): boolean {
  return (retryCount || 0) >= ABANDONED_RETRY_COUNT
}
