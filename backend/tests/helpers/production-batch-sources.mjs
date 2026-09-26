/*
 * 结构测试辅助：把拆分后的 production-batch-* 模块按顺序拼接。
 * 顺序 = production-batch.ts（核心 facade）
 *        → production-batch-loop.ts（执行引擎）
 *        → production-batch-queries.ts（查询层）
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'production-batch.ts',
  'production-batch-loop.ts',
  'production-batch-queries.ts',
]

/** @param backendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readProductionBatchSources(backendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(`src/services/${p}`, backendRoot), 'utf8'))
    .join('\n')
}
