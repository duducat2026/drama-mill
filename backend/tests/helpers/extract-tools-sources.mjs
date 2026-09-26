/*
 * 结构测试辅助：拼接提取 Agent 工具 5 模块为一份源码，保持旧正则断言成立。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'extract-tools.ts',
  'extract-tools-shared.ts',
  'extract-tools-character.ts',
  'extract-tools-scene.ts',
  'extract-tools-prop.ts',
]

/** @param backendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readExtractToolsSources(backendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(`src/agents/tools/${p}`, backendRoot), 'utf8'))
    .join('\n')
}
