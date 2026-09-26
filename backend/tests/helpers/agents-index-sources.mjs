/*
 * 结构测试辅助：拼接 agents/index.ts + prompts-defaults.ts + model-factory.ts。
 */
import { readFileSync } from 'node:fs'

const PARTS = ['index.ts', 'prompts-defaults.ts', 'model-factory.ts']

/** @param backendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readAgentsIndexSources(backendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(`src/agents/${p}`, backendRoot), 'utf8'))
    .join('\n')
}
