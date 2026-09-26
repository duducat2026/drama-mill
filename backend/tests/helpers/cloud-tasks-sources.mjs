/*
 * 测试辅助：拼接 cloud-tasks 拆分后的门面 + fetch/compare 源码，
 * 使旧的结构测试仍能对整个云端任务查询链路做正则断言。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'cloud-tasks.ts',
  'cloud-tasks-fetch.ts',
  'cloud-tasks-compare.ts',
]

export function readCloudTasksSources(backendRoot) {
  return PARTS
    .map((file) => readFileSync(new URL(`src/services/${file}`, backendRoot), 'utf8'))
    .join('\n')
}
