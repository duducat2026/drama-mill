/*
 * 结构测试辅助：拼接小说管理页（admin/novels.vue）拆分后的「页面 + AdminNovelSplitTemplates 模版面板子组件」为一份源码，
 * 使原有对单文件 admin/novels.vue 的正则断言（双标签/检索/模版增删改）继续成立。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'app/pages/admin/novels.vue',
  'app/components/AdminNovelSplitTemplates.vue',
]

/** @param frontendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readAdminNovelsSources(frontendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(p, frontendRoot), 'utf8'))
    .join('\n')
}
