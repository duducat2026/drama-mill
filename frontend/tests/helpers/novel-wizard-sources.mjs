/*
 * 结构测试辅助：拼接导入文档向导（NovelImportWizard.vue）拆分后的「组件 + useNovelWizard 逻辑 composable」为一份源码，
 * 使原有对单文件 NovelImportWizard.vue 的正则断言（拆分模版选择/批量两步走/字数预填等）继续成立。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'app/components/NovelImportWizard.vue',
  'app/composables/useNovelWizard.js',
]

/** @param frontendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readNovelWizardSources(frontendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(p, frontendRoot), 'utf8'))
    .join('\n')
}
