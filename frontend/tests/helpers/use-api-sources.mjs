/*
 * 结构测试辅助：拼接前端 useApi 门面拆分后的「门面 + ~/api/* 各域模块」为一份源码，
 * 使原有对单文件 useApi.ts 的正则断言（authHeaders/uploadAPI/adminAPI/accountAPI 等）继续成立。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'app/composables/useApi.ts',
  'app/api/core.ts',
  'app/api/drama.ts',
  'app/api/assets.ts',
  'app/api/tasks.ts',
  'app/api/novel.ts',
  'app/api/production.ts',
  'app/api/config.ts',
  'app/api/admin.ts',
  'app/api/auth.ts',
]

/** @param frontendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readUseApiSources(frontendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(p, frontendRoot), 'utf8'))
    .join('\n')
}
