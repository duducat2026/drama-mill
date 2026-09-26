/*
 * 结构测试辅助：拼接项目启动台（index.vue）拆分后的「页面 + ProjectCard 卡片 + ProjectCreateDialog 对话框 + useBatchBadge 轮询」为一份源码，
 * 使原有对单文件 index.vue 的正则断言（卡片/新建表单/批次轮询/状态快切等）继续成立。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'app/pages/index.vue',
  'app/components/ProjectCard.vue',
  'app/components/ProjectCreateDialog.vue',
  'app/composables/useBatchBadge.js',
]

/** @param frontendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readIndexPageSources(frontendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(p, frontendRoot), 'utf8'))
    .join('\n')
}
