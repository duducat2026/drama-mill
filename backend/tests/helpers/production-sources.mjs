/*
 * 结构测试辅助：把拆分后的 production-* 模块按「原单文件」顺序拼接为一份源码。
 * 顺序 = production.ts（核心：对外 API + re-export）
 *        → shared → steps → runner
 * 使原有对 production.ts 的正则/切片断言继续成立。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'production.ts',
  'production-shared.ts',
  'production-steps.ts',
  'production-runner.ts',
]

/** @param backendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readProductionSources(backendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(`src/services/${p}`, backendRoot), 'utf8'))
    .join('\n')
}
