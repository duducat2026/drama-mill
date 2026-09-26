/*
 * 测试辅助：拼接 admin/videos.vue 页面与其抽离出的 AdminRetryConfigBar 组件源码，
 * 使旧的结构测试仍能对整个平台视频页做正则断言。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'app/pages/admin/videos.vue',
  'app/components/AdminRetryConfigBar.vue',
]

export function readVideosPageSources(frontendRoot) {
  return PARTS
    .map((file) => readFileSync(new URL(file, frontendRoot), 'utf8'))
    .join('\n')
}
