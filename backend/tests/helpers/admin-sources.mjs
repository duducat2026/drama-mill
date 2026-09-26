/*
 * 结构测试辅助：routes/admin.ts 已按菜单域拆分为 routes/admin/*.ts 子路由。
 * 动态读取该目录下全部 .ts（含门面 index.ts / shared.ts 与各域路由）拼为一份源码，
 * 保持原有对单文件 admin.ts 的正则/切片断言继续成立，并对后续新增子路由文件自动生效。
 */
import { readFileSync, readdirSync } from 'node:fs'

const ADMIN_DIR = 'src/routes/admin'

/** index.ts / shared.ts 优先，其余按文件名排序，保证拼接稳定 */
function orderedFiles(backendRoot) {
  const files = readdirSync(new URL(ADMIN_DIR, backendRoot)).filter(f => f.endsWith('.ts'))
  const head = files.filter(f => f === 'index.ts' || f === 'shared.ts').sort()
  const rest = files.filter(f => f !== 'index.ts' && f !== 'shared.ts').sort()
  return [...head, ...rest]
}

/** @param backendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readAdminSources(backendRoot) {
  return orderedFiles(backendRoot)
    .map(f => readFileSync(new URL(`${ADMIN_DIR}/${f}`, backendRoot), 'utf8'))
    .join('\n')
}
