/*
 * settings.vue 页面门面 composable（拆分超限文件）。
 * 组合 useAiConfigs / useConfigEditor / useGenerateTest / useStylePresets 与模型调用总开关、
 * 后台看门狗开关，持有跨面板共享的状态（cfgs / serviceMeta / genTest / aiCallEnabled …），
 * 通过 provide('settings-ctx') 注入各 panel 子组件（子组件在自身 setup 里解构后按裸名引用，保持模板令牌不变）。
 */
import { toast } from 'vue-sonner'
import { aiCallOffMessage } from '~/composables/useAiSwitch'
import { useAiConfigs } from './useAiConfigs'
import { useConfigEditor } from './useConfigEditor'
import { useGenerateTest } from './useGenerateTest'
import { useStylePresets } from './useStylePresets'

export function useSettingsPage() {
  const cfgApi = useAiConfigs()
  const editor = useConfigEditor(cfgApi)
  const styles = useStylePresets()

  const tab = ref('ai')
  const cfgPage = computed(() => cfgApi.route.name === 'ai-config-editor')

  // ===== 模型调用总开关（用户侧）=====
  // 状态由 useAiSwitch 全站共享：此页切换后顶栏快捷开关与提示横幅同步
  const {
    aiCallEnabled, aiCallSubmitting, aiCallConfirmingOff, aiCallActiveTasks,
    refreshAiCall, requestAiCallToggle, confirmAiCallOff, cancelAiCallOff,
  } = useAiSwitch()
  const aiCallSwitchEl = ref(null)

  function notifyAiCall(enabled) {
    if (enabled) toast.success('模型调用已打开')
    else toast.warning('模型调用已关闭，AI 生成提交将被拒绝')
  }

  // 打开直接生效；关闭走确认弹窗（关闭会让排队/自动重提的任务判失败）
  async function onAiCallToggle(e) {
    try {
      const next = e?.target?.checked
      if (!await requestAiCallToggle(typeof next === 'boolean' ? next : undefined)) {
        // 用户转入确认流程：绑定位未变，Vue 不会重绘原生 checkbox，需手动回退其视觉态
        if (aiCallSwitchEl.value) aiCallSwitchEl.value.checked = aiCallEnabled.value
        return
      }
      notifyAiCall(aiCallEnabled.value)
    } catch (err) {
      toast.error(err.message)
    }
  }

  async function onAiCallOffConfirmed() {
    try {
      notifyAiCall(await confirmAiCallOff())
    } catch (err) {
      cancelAiCallOff()
      toast.error(err.message)
    }
  }

  // ===== 后台看门狗（独立菜单，默认均不启动）=====
  // 两项巡检都会后台替你发起付费调用，因此开关状态只服务本页，不做全站共享
  const { watchdogs, watchdogItems, watchdogSubmitting, refreshWatchdogs, toggleWatchdog } = useWatchdogSwitch()

  // 面板级汇总：单独成页后，页头说明「为什么默认不启动」，此处只反映当前授权态
  const watchdogOnCount = computed(() => watchdogItems.filter(w => watchdogs[w.kind]).length)
  const watchdogSummary = computed(() => watchdogOnCount.value
    ? `已开启 ${watchdogOnCount.value} 项：后台巡检会按用量替你提交模型调用。`
    : '两项均未开启：后台不会替你提交任何模型调用，失败任务与缺图资产需本人手动发起。')

  async function onWatchdogToggle(kind, e) {
    const item = watchdogItems.find(w => w.kind === kind)
    try {
      const next = e?.target?.checked
      const state = await toggleWatchdog(kind, typeof next === 'boolean' ? next : undefined)
      if (state[kind]) toast.success(`已开启「${item?.label}」，后台巡检会自动重提交`)
      else toast.warning(`已停止「${item?.label}」，失败任务与缺图资产需手动发起`)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const genTest = useGenerateTest(cfgApi, aiCallEnabled)

  const ctx = {
    tab, cfgPage,
    ...cfgApi, ...editor, ...styles, ...genTest,
    aiCallEnabled, aiCallSubmitting, aiCallConfirmingOff, aiCallActiveTasks, aiCallSwitchEl,
    aiCallOffMessage, refreshAiCall, onAiCallToggle, onAiCallOffConfirmed, cancelAiCallOff,
    watchdogs, watchdogItems, watchdogSubmitting, watchdogOnCount, watchdogSummary, onWatchdogToggle, refreshWatchdogs,
  }
  provide('settings-ctx', ctx)
  return ctx
}
