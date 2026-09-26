/*
 * 测试辅助：拼接 model-catalog 拆分后的门面 + query/import 源码，
 * 使旧的结构测试仍能对整个目录价服务做正则断言。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'model-catalog.ts',
  'model-catalog-query.ts',
  'model-catalog-import.ts',
]

export function readModelCatalogSources(backendRoot) {
  return PARTS
    .map((file) => readFileSync(new URL(`src/services/${file}`, backendRoot), 'utf8'))
    .join('\n')
}
