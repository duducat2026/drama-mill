/*
 * 测试辅助：拼接 tasks 拆分后的多模块源码，
 * 使旧的结构测试仍能对整条任务路由链路做正则断言。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'tasks.ts',
  'tasks-shared.ts',
  'tasks-cloud-queue.ts',
]

export function readTasksRouteSources(backendRoot) {
  return PARTS
    .map((file) => readFileSync(new URL(`src/routes/${file}`, backendRoot), 'utf8'))
    .join('\n')
}
