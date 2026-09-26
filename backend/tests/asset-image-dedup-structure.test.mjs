// 资产图片任务基于状态的提交去重 — 结构测试（源码断言，沿用现有约定）
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readGenerationSources } from './helpers/generation-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('asset-images：提交入口按资产状态去重，活跃任务复用不新建', () => {
  const src = read('src/services/asset-images.ts')
  // 活跃态判定与 asset-watchdog 一致（排队中也算占着资产）
  assert.match(src, /ACTIVE_TASK_STATUSES = \['processing', 'pending'\]/)
  assert.match(src, /async function findActiveImageTask/)
  // 三类资产入口全部接入幂等守卫：有进行中任务则复用其任务 ID
  for (const kind of ['characterId', 'sceneId', 'propId']) {
    assert.match(src, new RegExp(`findActiveImageTask\\('${kind}'`))
  }
  assert.match(src, /duplicate-reuse/)
  // 复用时不新建任务：直接返回已有任务 ID
  assert.match(src, /return existing/)
})

test('generation：排队期间状态被改写的任务出队即跳过，不再提交上游', () => {
  const src = readGenerationSources(root)
  assert.match(src, /record\.status !== 'processing'/)
  assert.match(src, /skip-non-processing/)
})

test('scripts：存量重复任务清理脚本，已提交上游的保留只合并排队中的', () => {
  const src = read('scripts/dedupe-active-image-tasks.ts')
  // 按资产归组：角色/场景/道具三个维度
  assert.match(src, /\['characterId', 'sceneId', 'propId'\]/)
  // 计费保护：持有 task_id（已提交上游）的任务不参与合并
  assert.match(src, /tasks\.filter\(t => !!t\.taskId\)/)
  // 未提交的保留最早一个，其余判失败并注明合并来源
  assert.match(src, /queued\.slice\(1\)/)
  assert.match(src, /已合并/)
  // 带状态守卫更新，防止与在途流程竞态
  assert.match(src, /eq\(schema\.sysTask\.status, dup\.status!\)/)
})

test('asset-watchdog：看门狗自身去重仍保留（与新守卫形成双保险）', () => {
  const src = read('src/services/asset-watchdog.ts')
  assert.match(src, /getBusyAssetIds/)
  assert.match(src, /\['processing', 'pending'\]/)
})
