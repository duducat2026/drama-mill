/*
 * 测试辅助：拼接 migrations 拆分后的门面 + columns/seed 源码，
 * 使旧的结构测试仍能对整个迁移流程做正则断言。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'migrations.ts',
  'migrations-columns.ts',
  'migrations-seed.ts',
]

export function readMigrationsSources(backendRoot) {
  return PARTS
    .map((file) => readFileSync(new URL(`src/db/${file}`, backendRoot), 'utf8'))
    .join('\n')
}
