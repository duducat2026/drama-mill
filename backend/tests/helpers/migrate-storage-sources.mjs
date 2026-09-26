/*
 * 测试辅助：拼接 migrate-storage-layout 拆分后的入口 + state/scan/files 源码，
 * 使旧的结构测试仍能对整个迁移流程做正则断言。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'scripts/migrate-storage-layout.ts',
  'scripts/migrate-storage-layout/state.ts',
  'scripts/migrate-storage-layout/scan.ts',
  'scripts/migrate-storage-layout/files.ts',
]

export function readMigrateStorageSources(backendRoot) {
  return PARTS
    .map((file) => readFileSync(new URL(file, backendRoot), 'utf8'))
    .join('\n')
}
