/*
 * 结构测试辅助：把拆分后的 generation-* 模块按「原单文件」顺序拼接为一份源码。
 * 顺序 = generation.ts（门面：对外 API + re-export）→ shared → helpers → 各职责模块
 * 使原有对 generation.ts 的正则/切片断言继续成立。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'generation.ts',
  'generation-shared.ts',
  'generation-helpers.ts',
  'generation-gateway.ts',
  'generation-router.ts',
  'generation-queue.ts',
  'generation-generate.ts',
  'generation-refs.ts',
  'generation-poll.ts',
  'generation-recovery.ts',
  'generation-selfheal.ts',
  'generation-refs.ts',
  'generation-watchdog-queries.ts',
]

/** @param backendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readGenerationSources(backendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(`src/services/${p}`, backendRoot), 'utf8'))
    .join('\n')
}
