/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { toast } from 'vue-sonner'
import { useAgent } from '~/composables/useAgent'
import { useAiSwitch, AI_CALL_OFF_TIP, aiCallOffMessage } from '~/composables/useAiSwitch'

export function useEpisodeAiCallSwitch(wb: any) {
const { running: rn, runningType: rt, run: runAgent } = useAgent()
// ===== 模型调用总开关（用户侧）=====
// 关闭后服务端拒绝一切新发起的 AI 调用；顶栏快捷开关与关闭提示横幅共用 useAiSwitch 的全局状态
const {
  aiCallEnabled, aiCallSubmitting, aiCallConfirmingOff, aiCallActiveTasks,
  refreshAiCall, requestAiCallToggle, confirmAiCallOff, cancelAiCallOff,
} = useAiSwitch()

// 打开（含横幅「立即打开」）直接生效；关闭先弹二次确认——关闭会让排队与自动重提的任务判失败
async function onAiCallToggle(next) {
  try {
    if (!await requestAiCallToggle(typeof next === 'boolean' ? next : undefined)) return
    toast.success('模型调用已打开')
  } catch (e) {
    toast.error(e.message)
  }
}

async function onAiCallOffConfirmed() {
  try {
    if (await confirmAiCallOff()) toast.success('模型调用已打开')
    else toast.warning(AI_CALL_OFF_TIP)
  } catch (e) {
    cancelAiCallOff()
    toast.error(e.message)
  }
}
// 剧本改写异步状态（独立于 useAgent 的同步模式，支持后台执行+刷新不中断+失败重试）
  return {
    rn, rt, runAgent, aiCallEnabled, aiCallSubmitting, aiCallConfirmingOff, aiCallActiveTasks, refreshAiCall, requestAiCallToggle, confirmAiCallOff, cancelAiCallOff, onAiCallToggle, onAiCallOffConfirmed,
  }
}
