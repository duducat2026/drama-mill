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
 * 后台看门狗用户侧授权 — 两项巡检「是否允许后台替本人发起模型调用」，默认都不启动。
 *
 * 为什么默认关闭：自动重提失败任务、自动补生成缺图资产都没有提交入口，
 * 用户看不见却会按用量计价，因此改为设置页显式 opt-in，关闭即彻底不参与巡检。
 *
 * 仅设置页使用（不像模型调用总开关那样全站共享），故用普通响应式状态而非 useState。
 * 提交走乐观更新 + 后端拒绝回滚，同一时刻只允许一个开关在途，避免连点写串。
 */
import { watchdogAPI, type WatchdogKind } from './useApi'

export const WATCHDOG_ITEMS: { kind: WatchdogKind; label: string; desc: string; tip: string }[] = [
  {
    kind: 'retry',
    label: '失败任务自动重提',
    desc: '开启后，后台巡检会自动重提近期生成失败的图片/视频任务（受重试次数与时间窗口约束）。关闭后需本人手动重试。',
    tip: '自动重提会再次调用模型并按用量计价，关闭后失败任务只保留人工重试入口',
  },
  {
    kind: 'asset',
    label: '缺图资产自动补生成',
    desc: '开启后，后台巡检会自动为缺图的角色、场景、道具补生成图片（生产中断或任务丢失的兜底）。关闭后仅生产流程与手动入口生成。',
    tip: '自动补图会替你发起图片生成并计价，关闭后不再有后台补生成',
  },
]

export function useWatchdogSwitch() {
  // 默认 false，与后端 users.*_watchdog_enabled DEFAULT 0 一致，/auth/watchdogs 返回后校准
  const watchdogs = reactive<Record<WatchdogKind, boolean>>({ retry: false, asset: false })
  const watchdogSubmitting = ref<WatchdogKind | null>(null)

  async function refreshWatchdogs() {
    try {
      const data = await watchdogAPI.get()
      if (data) {
        watchdogs.retry = !!data.retry
        watchdogs.asset = !!data.asset
      }
    } catch { /* 拉取失败保留现值（默认不启动），不阻塞设置页其余部分 */ }
  }

  /** 切换某个看门狗：乐观更新，后端拒绝则回滚并抛出（由调用方 toast 提示） */
  async function toggleWatchdog(kind: WatchdogKind, next?: boolean) {
    const target = next ?? !watchdogs[kind]
    if (watchdogSubmitting.value || target === watchdogs[kind]) return watchdogs
    const prev = watchdogs[kind]
    watchdogs[kind] = target
    watchdogSubmitting.value = kind
    try {
      const data = await watchdogAPI.set(kind, target)
      if (data) {
        watchdogs.retry = !!data.retry
        watchdogs.asset = !!data.asset
      }
      return watchdogs
    } catch (e) {
      watchdogs[kind] = prev
      throw e
    } finally {
      watchdogSubmitting.value = null
    }
  }

  return { watchdogs, watchdogItems: WATCHDOG_ITEMS, watchdogSubmitting, refreshWatchdogs, toggleWatchdog }
}
