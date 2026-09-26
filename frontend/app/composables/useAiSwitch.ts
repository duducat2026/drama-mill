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
 * 模型调用总开关（用户侧）— 一处状态全站共享：设置页开关卡片、顶栏快捷开关、关闭提示横幅共用。
 *
 * 数据源：/auth/me 随用户信息带出 aiCallEnabled（登录/刷新即得），/auth/ai-call 用于兜底刷新与写入。
 * 关闭后后端拒绝一切新发起的 AI 调用（文本/图片/视频/重试/编排启动）：已提交上游的在途任务照常完成，
 * 但排队中与自动重提的任务会被判失败，因此「关闭」方向一律先弹二次确认（见 requestAiCallToggle）。
 */
import { aiCallAPI, taskAPI } from './useApi'

/** 后端关闭文案的同义提示：前端禁用态与失败提示统一用它，避免各处措辞漂移 */
export const AI_CALL_OFF_TIP = '模型调用已关闭，打开后才能发起文本、图片和视频生成'

/**
 * 关闭前确认文案：带上本人在途任务数。
 * 关闭期间排队中/自动重提的任务会被服务端直接判失败（正在提交上游的仍会跑完），
 * 这是「关闭即拒绝提交」语义的既有代价，必须让用户在确认框里看清楚再动手。
 */
export function aiCallOffMessage(activeTotal: number): string {
  return activeTotal > 0
    ? `关闭后新的文本、图片、视频提交都会被服务端拒绝。当前你有 ${activeTotal} 个生成中/排队中的任务：已在上游生成的会继续完成，但排队与自动重提的任务会被判失败，需重新打开后再重试。`
    : '关闭后新的文本、图片、视频提交都会被服务端拒绝，用于暂停额度消耗；正在生成中的任务不受影响。'
}

export function useAiSwitch() {
  const { user } = useAuth()
  // 默认视为开启（与后端默认值一致），/auth/me 返回后再校准
  const enabled = useState<boolean>('ai-call-enabled', () => user.value?.aiCallEnabled !== false)
  const submitting = useState<boolean>('ai-call-submitting', () => false)
  // 关闭二次确认：确认态与在途任务数全站共享，避免同一时刻弹出多个确认框
  const confirmingOff = useState<boolean>('ai-call-confirming-off', () => false)
  const activeTasks = useState<number>('ai-call-active-tasks', () => 0)

  // /auth/me 异步落地（登录、刷新页面）时同步本端状态
  watch(() => user.value?.aiCallEnabled, (v) => { if (v !== undefined) enabled.value = v !== false })

  async function refreshAiCall() {
    try {
      enabled.value = !!(await aiCallAPI.get())?.enabled
    } catch { /* 拉取失败保留现值，不阻塞页面 */ }
  }

  /** 本人在途（生成中 + 排队中）任务数：仅用于关闭确认提示，取数失败按 0 处理不阻塞确认 */
  async function loadActiveTasks() {
    try {
      const res = await taskAPI.list({ status: 'pending,processing', page: 1, page_size: 1 })
      activeTasks.value = res?.pagination?.total ?? 0
    } catch { activeTasks.value = 0 }
  }

  /**
   * 切换开关的统一入口：打开方向直接提交；关闭方向转入确认弹窗。
   * 返回 false 表示未提交、已转为等待用户确认（调用方需回退原生 checkbox 的视觉态）。
   */
  async function requestAiCallToggle(next?: boolean): Promise<boolean> {
    const target = next ?? !enabled.value
    if (!target) {
      confirmingOff.value = true
      void loadActiveTasks()
      return false
    }
    await toggleAiCall(true)
    return true
  }

  /** 确认关闭：真正提交关闭（抛出由调用方 toast 提示） */
  async function confirmAiCallOff(): Promise<boolean> {
    confirmingOff.value = false
    return toggleAiCall(false)
  }

  function cancelAiCallOff() { confirmingOff.value = false }

  /** 切换开关：先乐观更新，后端拒绝则回滚并抛出（由调用方 toast 提示） */
  async function toggleAiCall(next?: boolean): Promise<boolean> {
    if (submitting.value) return enabled.value
    const prev = enabled.value
    const target = next ?? !prev
    if (target === prev) return prev
    enabled.value = target
    submitting.value = true
    try {
      const data = await aiCallAPI.set(target)
      enabled.value = data?.enabled ?? target
      if (user.value) user.value.aiCallEnabled = enabled.value
      return enabled.value
    } catch (e) {
      enabled.value = prev
      throw e
    } finally {
      submitting.value = false
    }
  }

  return {
    aiCallEnabled: enabled,
    aiCallSubmitting: submitting,
    aiCallConfirmingOff: confirmingOff,
    aiCallActiveTasks: activeTasks,
    refreshAiCall,
    toggleAiCall,
    requestAiCallToggle,
    confirmAiCallOff,
    cancelAiCallOff,
  }
}
