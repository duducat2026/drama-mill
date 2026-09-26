/*
 * 结构测试辅助：拼接 admin 运行监控页拆分后的「页面 + AdminMonitorCharts 子组件」为一份源码，
 * 使原有对单文件 monitor.vue 的正则断言（trendChart/statusDonut/环形图/SVG 等）继续成立。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'app/pages/admin/monitor.vue',
  'app/components/AdminMonitorCharts.vue',
]

/** @param frontendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readMonitorPageSources(frontendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(p, frontendRoot), 'utf8'))
    .join('\n')
}
