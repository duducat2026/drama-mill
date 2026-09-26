/*
 * 测试辅助：episode.vue 已按面板/组件机械拆分（薄壳 + views/drama/episode 子目录 .vue
 * + composables/episode 目录 .ts），拼接全部拆出源码，使旧的结构测试仍能对整个
 * episode 工作台做正则断言（match / doesNotMatch 语义与拆分前单文件一致）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function walkVue(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e)
    if (statSync(p).isDirectory()) out.push(...walkVue(p))
    else if (e.endsWith('.vue')) out.push(p)
  }
  return out.sort()
}

export function episodeViewSource() {
  const parts = [readFileSync(path.join(FRONTEND, 'app/views/drama/episode.vue'), 'utf8')]
  for (const f of walkVue(path.join(FRONTEND, 'app/views/drama/episode'))) parts.push(readFileSync(f, 'utf8'))
  const compDir = path.join(FRONTEND, 'app/composables/episode')
  if (existsSync(compDir)) {
    for (const f of readdirSync(compDir).filter(s => s.endsWith('.ts')).sort()) {
      parts.push(readFileSync(path.join(compDir, f), 'utf8'))
    }
  }
  return parts.join('\n')
}
