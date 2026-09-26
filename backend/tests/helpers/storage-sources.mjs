/*
 * 测试辅助：拼接 storage 拆分后的门面 + core/write/image 源码，
 * 使旧的结构测试仍能对整个存储工具做正则断言。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'storage.ts',
  'storage-core.ts',
  'storage-write.ts',
  'storage-image.ts',
]

export function readStorageSources(backendRoot) {
  return PARTS
    .map((file) => readFileSync(new URL(`src/utils/${file}`, backendRoot), 'utf8'))
    .join('\n')
}
