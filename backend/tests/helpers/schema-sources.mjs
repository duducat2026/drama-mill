/*
 * 结构测试辅助：拼接 schema.ts + schema-content.ts + schema-config.ts + schema-catalog.ts 为一份源码。
 */
import { readFileSync } from 'node:fs'

const PARTS = ['schema.ts', 'schema-content.ts', 'schema-config.ts', 'schema-catalog.ts']

/** @param backendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readSchemaSources(backendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(`src/db/${p}`, backendRoot), 'utf8'))
    .join('\n')
}
