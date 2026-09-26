/*
 * 测试辅助：拼接 admin/model-catalog.vue 页面与其抽离出的 ModelCatalogImportModal 组件源码，
 * 使旧的结构测试仍能对整个模型目录价页做正则断言。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'app/pages/admin/model-catalog.vue',
  'app/components/ModelCatalogImportModal.vue',
]

export function readModelCatalogPageSources(frontendRoot) {
  return PARTS
    .map((file) => readFileSync(new URL(file, frontendRoot), 'utf8'))
    .join('\n')
}
