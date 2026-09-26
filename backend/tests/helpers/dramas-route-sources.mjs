/*
 * 结构测试辅助：把拆分后的 dramas-* 路由模块按顺序拼接为一份源码供正则断言。
 * 顺序 = dramas.ts（门面：项目 CRUD / stats / 详情 summary）
 *        → dramas-assets.ts（子路由：assets-status / characters / episodes 批量保存）
 *        → dramas-shared.ts（共享纯函数：normalizeMetadata / countByDrama / stripAssetHeavy）
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'dramas.ts',
  'dramas-assets.ts',
  'dramas-shared.ts',
]

/** @param backendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readDramasRouteSources(backendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(`src/routes/${p}`, backendRoot), 'utf8'))
    .join('\n')
}
