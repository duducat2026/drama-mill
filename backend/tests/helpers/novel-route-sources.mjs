/*
 * 结构测试辅助：拼接 novels.ts + novels-production.ts 为一份源码。
 */
import { readFileSync } from 'node:fs'

const PARTS = ['novels.ts', 'novels-production.ts']

/** @param backendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readNovelRouteSources(backendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(`src/routes/${p}`, backendRoot), 'utf8'))
    .join('\n')
}
