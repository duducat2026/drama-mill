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
 * 看门狗用户侧开关 — 两个后台巡检「是否替本人自动提交模型调用」的授权位，默认都不启动。
 *
 * 为什么默认关闭：看门狗的动作是「后台悄悄再发一次付费调用」（失败任务自动重提、缺图资产自动补生成），
 * 用户看不见提交入口也拦不住，与「额度消耗必须知情」相冲突，因此改为显式 opt-in。
 *
 * 粒度与语义：
 * - 只控制「自动提交」这一步；巡检里的卡死判定、失败落库、状态同步等不碰模型的清理照常执行
 *   （否则孤儿任务会永远占着轮询与面板），因此开关判定挂在各看门狗的重提/补图循环内，而非定时器本身；
 *   候选取数同样用 watchdogConsentSql 下推授权条件，让每轮限量只花在已授权用户的任务上。
 * - 与模型调用总开关是「与」关系：总开关关闭时看门狗一律跳过，本开关不参与覆盖它。
 * - 无归属（userId 缺省）的任务/项目按未授权处理，与「默认不启动」一致。
 *
 * 状态存 users.retry_watchdog_enabled / users.asset_watchdog_enabled。
 */
import { eq, sql, type Column, type SQL } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { logTaskProgress } from '../utils/task-logger.js'

export type WatchdogKind = 'retry' | 'asset'

/** 用户侧展示元信息：文案与说明集中在此，避免前后端措辞漂移 */
export const WATCHDOG_META: Record<WatchdogKind, { column: 'retryWatchdogEnabled' | 'assetWatchdogEnabled'; label: string; desc: string }> = {
  retry: {
    column: 'retryWatchdogEnabled',
    label: '失败任务自动重提',
    desc: '开启后，生成失败的任务由后台巡检自动重提（受重试次数与时间窗口约束）；关闭时需本人手动重试。',
  },
  asset: {
    column: 'assetWatchdogEnabled',
    label: '缺图资产自动补生成',
    desc: '开启后，后台巡检会自动为缺图的角色/场景/道具补生成图片；关闭后只在生产流程与手动入口生成。',
  },
}

const COLUMNS = Object.keys(WATCHDOG_META) as WatchdogKind[]

function columnOf(kind: WatchdogKind) {
  return schema.users[WATCHDOG_META[kind].column]
}

/** 该用户是否授权本人该看门狗自动提交模型调用（默认否；userId 缺省按未授权） */
export async function isWatchdogEnabled(kind: WatchdogKind, userId?: number | null): Promise<boolean> {
  if (!userId) return false
  const [row] = await db.select({ enabled: columnOf(kind) }).from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1)
  // 列为 NULL（迁移未覆盖到的极端情况）按不启动处理，遵循「默认关闭」策略
  return row?.enabled === true
}

/** 是否至少有一个用户授权了该看门狗：巡检开头的总闸，无人授权时整轮不做任何取数 */
export async function anyWatchdogEnabled(kind: WatchdogKind): Promise<boolean> {
  const rows = await db.select({ id: schema.users.id }).from(schema.users)
    .where(eq(columnOf(kind), true))
    .limit(1)
  return rows.length > 0
}

/**
 * 取数下推条件：只保留「归属人已授权该看门狗」的行（ownerColumn 传任务/项目的归属人列）。
 *
 * 为什么下推而不是只在循环里判：候选查询带每轮限量且按 updated_at DESC 取最新 N 条，
 * 未授权用户的失败会照样占满这些名额，导致已授权用户的任务在时间窗口内一直排不进（开了却不动）。
 *
 * 为什么用 EXISTS 而不是 join：join users 会与 sys_task / dramas 的 id、status、created_at 等
 * 同名列冲突，打乱既有记录类型；EXISTS 走 users 主键点查，且归属人为 NULL 时天然不成立
 * （等价「无归属按未授权」）。
 */
export function watchdogConsentSql(kind: WatchdogKind, ownerColumn: SQL | Column): SQL {
  return sql`EXISTS (SELECT 1 FROM ${schema.users} WHERE ${schema.users.id} = ${ownerColumn} AND ${columnOf(kind)} = 1)`
}

/** 本人两个看门狗开关的当前状态（设置页读取） */
export async function getWatchdogSwitches(userId: number): Promise<Record<WatchdogKind, boolean>> {
  const [row] = await db.select({
    retryWatchdogEnabled: schema.users.retryWatchdogEnabled,
    assetWatchdogEnabled: schema.users.assetWatchdogEnabled,
  }).from(schema.users).where(eq(schema.users.id, userId))
  return {
    retry: row?.retryWatchdogEnabled === true,
    asset: row?.assetWatchdogEnabled === true,
  }
}

/** 写入某个看门狗开关，返回写入后的全部状态（供前端一次性校准两个开关） */
export async function setWatchdogSwitch(userId: number, kind: WatchdogKind, enabled: boolean): Promise<Record<WatchdogKind, boolean>> {
  await db.update(schema.users)
    .set({ [WATCHDOG_META[kind].column]: enabled, updatedAt: now() })
    .where(eq(schema.users.id, userId))
  logTaskProgress('WatchdogSwitch', 'toggle', { userId, kind, enabled })
  return getWatchdogSwitches(userId)
}

export function isWatchdogKind(kind: unknown): kind is WatchdogKind {
  return typeof kind === 'string' && COLUMNS.includes(kind as WatchdogKind)
}
