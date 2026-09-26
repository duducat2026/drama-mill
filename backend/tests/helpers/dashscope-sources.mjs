/*
 * 结构测试辅助：拼接 dashscope.ts + dashscope-shared.ts + dashscope-image.ts + dashscope-video.ts
 * 为一份源码，保持旧的正则断言继续成立。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'dashscope.ts',
  'dashscope-shared.ts',
  'dashscope-image.ts',
  'dashscope-video.ts',
]

/** @param backendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readDashScopeSources(backendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(`src/services/adapters/${p}`, backendRoot), 'utf8'))
    .join('\n')
}
