/*
 * 结构测试辅助：拼接 mysql-schema.ts + content + platform + seeds 为一份源码。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'mysql-schema.ts',
  'mysql-schema-content.ts',
  'mysql-schema-platform.ts',
  'mysql-schema-seeds.ts',
]

/** @param backendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readMysqlSchemaSources(backendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(`src/db/${p}`, backendRoot), 'utf8'))
    .join('\n')
}
