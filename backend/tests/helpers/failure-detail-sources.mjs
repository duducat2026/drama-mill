/*
 * 测试辅助：拼接 failure-detail 拆分后的门面 + parse + rules 源码，
 * 使旧的结构测试仍能对整个失败诊断服务做正则断言。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'failure-detail.ts',
  'failure-detail-parse.ts',
  'failure-detail-rules.ts',
]

export function readFailureDetailSources(backendRoot) {
  return PARTS
    .map((file) => readFileSync(new URL(`src/services/${file}`, backendRoot), 'utf8'))
    .join('\n')
}
