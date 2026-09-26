/*
 * 结构测试辅助：拼接 episodes.ts + episodes-pipeline.ts 为一份源码。
 */
import { readFileSync } from 'node:fs'

const PARTS = ['episodes.ts', 'episodes-pipeline.ts']

/** @param backendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readEpisodeRouteSources(backendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(`src/routes/${p}`, backendRoot), 'utf8'))
    .join('\n')
}
