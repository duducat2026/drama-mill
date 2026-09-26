// 生成产物多租户归属 — 结构测试（源码断言，沿用现有约定）
// 背景：编排/批量入口提交图片/视频任务时缺 userId，落盘退回 0/{drama}，
// 且启动回填把 NULL 一律划给种子账号，导致用户空间看不到自己生成的文件。
import { readMigrationsSources } from './helpers/migrations-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('asset-images：编排/批量图片任务按剧集 owner 落库 userId', () => {
  const src = read('src/services/asset-images.ts')
  // 剧集所有者解析（编排与批量入口无请求态用户）
  assert.match(src, /async function dramaOwnerId\(dramaId: number \| null \| undefined\)/)
  assert.match(src, /schema\.dramas\.userId/)
  // 三类资产提交入口全部携带 userId（租户目录与配额归属依赖）
  assert.match(src, /characterId: id, dramaId: char\.dramaId[\s\S]*?userId: await dramaOwnerId\(char\.dramaId\)/)
  assert.match(src, /sceneId: id, dramaId: scene\.dramaId[\s\S]*?userId: await dramaOwnerId\(scene\.dramaId\)/)
  assert.match(src, /propId: id, dramaId: prop\.dramaId[\s\S]*?userId: await dramaOwnerId\(prop\.dramaId\)/)
})

test('episode-videos：分镜视频批量提交携带剧集 owner', () => {
  const src = read('src/services/episode-videos.ts')
  assert.match(src, /userId: drama\?\.userId \?\? undefined/)
})

test('migrations：归属回填先按剧集所有者，再兜底种子账号（防跨租户错归）', () => {
  const src = readMigrationsSources(root)
  // 有 drama_id 的行按剧集所有者回填
  assert.match(src, /JOIN dramas d ON t\.drama_id = d\.id/)
  assert.match(src, /SET t\.user_id = d\.user_id/)
  assert.match(src, /WHERE t\.user_id IS NULL AND d\.user_id IS NOT NULL/)
  // 按剧集回填必须排在种子账号兜底之前（先精确归属，再兜底无关联历史数据）
  const joinIdx = src.indexOf('JOIN dramas d ON t.drama_id = d.id')
  const fallbackIdx = src.indexOf("WHERE user_id IS NULL`, [owner.id]")
  assert.ok(joinIdx > -1 && fallbackIdx > -1 && joinIdx < fallbackIdx, '按剧集回填必须先于种子账号兜底')
})
