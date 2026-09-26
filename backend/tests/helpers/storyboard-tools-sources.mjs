/*
 * 结构测试辅助：拼接分镜工具 4 模块为一份源码，保持旧正则断言成立。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'storyboard-tools.ts',
  'storyboard-tools-shared.ts',
  'storyboard-tools-read.ts',
  'storyboard-tools-write.ts',
]

/** @param backendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readStoryboardToolsSources(backendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(`src/agents/tools/${p}`, backendRoot), 'utf8'))
    .join('\n')
}
