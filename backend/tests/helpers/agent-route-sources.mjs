/*
 * 结构测试辅助：拼接 agent.ts + agent-async.ts 为一份源码。
 */
import { readFileSync } from 'node:fs'

const PARTS = ['agent.ts', 'agent-async.ts']

/** @param backendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readAgentRouteSources(backendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(`src/routes/${p}`, backendRoot), 'utf8'))
    .join('\n')
}
