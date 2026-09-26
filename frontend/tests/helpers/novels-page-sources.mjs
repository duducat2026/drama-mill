/*
 * 结构测试辅助：拼接文档库页面（novels.vue）拆分后的「页面 + useNovelsLibrary 逻辑 composable
 * + 批量创建项目弹窗 + 文档拆分弹窗 + 外置样式」为一份源码，
 * 使原有对单文件 novels.vue 的正则断言（列表/分页/预览/编辑/删除/导入/建项目两步走/滚动布局等）继续成立。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'app/pages/novels.vue',
  'app/composables/useNovelsLibrary.js',
  'app/components/NovelsCreateProjectsDialog.vue',
  'app/components/NovelsPreSplitDialog.vue',
  'app/assets/styles/novels.css',
]

/** @param frontendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readNovelsPageSources(frontendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(p, frontendRoot), 'utf8'))
    .join('\n')
}
