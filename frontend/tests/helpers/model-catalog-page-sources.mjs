/*
 * 测试辅助：读取 admin/model-catalog.vue 页面源码（含抽离组件时预留的拼接口），
 * 使结构测试能对整个模型目录价页做正则断言。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'app/pages/admin/model-catalog.vue',
]

export function readModelCatalogPageSources(frontendRoot) {
  return PARTS
    .map((file) => readFileSync(new URL(file, frontendRoot), 'utf8'))
    .join('\n')
}
