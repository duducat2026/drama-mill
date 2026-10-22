// 用户「模型价格」面板拆分后的源码拼接 helper。
// 面板（价目单列表）与「从平台目录导入」弹窗是两个组件，跨页选择 / 单次上限 /
// 写后强刷等断言目标都在弹窗内，因此按 [面板, 弹窗] 顺序拼接后统一匹配。
import { readFileSync } from 'node:fs'

const PARTS = [
  'app/components/settings/SettingsPricesPanel.vue',
  'app/components/settings/SettingsPricesImportDialog.vue',
]

export function readPricesPanelSources(frontendRoot) {
  return PARTS.map(p => readFileSync(new URL(p, frontendRoot), 'utf8')).join('\n')
}

export function readPricesCss(frontendRoot) {
  return readFileSync(new URL('app/assets/styles/settings.prices.css', frontendRoot), 'utf8')
}
