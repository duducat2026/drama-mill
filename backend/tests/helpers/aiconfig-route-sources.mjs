/*
 * 结构测试辅助：拼接 aiConfigs.ts + ai-config-probe.ts 为一份源码。
 */
import { readFileSync } from 'node:fs'

const PARTS = ['ai-config-probe.ts', 'aiConfigs.ts']

/** @param backendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readAiConfigRouteSources(backendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(`src/routes/${p}`, backendRoot), 'utf8'))
    .join('\n')
}
