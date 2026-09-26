// settings.vue 拆分后的源码拼接 helper（供结构测试读取跨 shell/面板/composable 的断言）。
// 顺序保证：ai-call-panel(SettingsAiPanel) < setup-panel(SettingsWatchdogPanel)、
// baseTabs/onMounted/definePageMeta/主图标 import 在 shell、providerPresets→byType 与
// genTest reactive / loadCfgEditor→apiKeyVisible 各自在同文件内连续。
import { readFileSync } from 'node:fs'

const PARTS = [
  'app/pages/settings.vue',
  'app/components/settings/SettingsAiPanel.vue',
  'app/components/settings/SettingsWatchdogPanel.vue',
  'app/components/settings/SettingsStylesPanel.vue',
  'app/components/settings/SettingsCfgEditor.vue',
  'app/components/settings/SettingsGenTestDialog.vue',
  'app/composables/settings/useSettingsPage.js',
  'app/composables/settings/useAiConfigs.js',
  'app/composables/settings/useConfigEditor.js',
  'app/composables/settings/useGenerateTest.js',
  'app/composables/settings/useStylePresets.js',
]

export function readSettingsSources(frontendRoot) {
  return PARTS.map(p => readFileSync(new URL(p, frontendRoot), 'utf8')).join('\n')
}
