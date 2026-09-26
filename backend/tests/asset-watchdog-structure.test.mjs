// 资产图片巡检看门狗 — 结构测试（源码断言，沿用现有约定）
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readProductionSources } from './helpers/production-sources.mjs'
import { readDetailSources } from '../../frontend/tests/helpers/detail-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('rate-config：巡检间隔默认 20 分钟且单轮重提有上限', () => {
  const src = read('src/utils/rate-config.ts')
  assert.match(src, /ASSET_WATCHDOG_INTERVAL_MS/)
  assert.match(src, /20 \* 60 \* 1000/)
  assert.match(src, /ASSET_WATCHDOG_MAX_RESUBMIT/)
  // 状态接口可见巡检配置
  assert.match(src, /asset_watchdog:\s*\{/)
})

test('asset-watchdog：目标范围/去重/限量/定时四要素', () => {
  const src = read('src/services/asset-watchdog.ts')
  // 巡检目标：生产中/失败项目 + 未完成但已有分镜的中断项目
  assert.match(src, /\['producing', 'failed'\]\.includes/)
  assert.match(src, /storyboards/)
  // 跳过内存中活跃/暂停的编排（活跃自带补跑，暂停是用户意图）
  assert.match(src, /run\.status !== 'running' && run\.status !== 'paused'/)
  // 重提条件：缺图且无进行中图片任务
  assert.match(src, /!c\.imageUrl/)
  assert.match(src, /\['processing', 'pending'\]/)
  // 复用共享批量提交（走 generation 队列与槽位闸门）
  assert.match(src, /batchGenerateCharacterImages/)
  assert.match(src, /batchGenerateSceneImages/)
  assert.match(src, /batchGeneratePropImages/)
  // 单轮上限截断 + 定时循环
  assert.match(src, /ASSET_WATCHDOG_MAX_RESUBMIT/)
  assert.match(src, /setInterval/)
  assert.match(src, /runAssetWatchdogOnce/)
})

test('production：getEpisodeAssets 导出复用，生产状态含每集视频生成中数量', () => {
  const src = readProductionSources(root)
  assert.match(src, /export async function getEpisodeAssets/)
  assert.match(src, /videos_generating/)
  // 视频生成中数量只统计 processing/pending 的 video 任务
  assert.match(src, /eq\(schema\.sysTask\.type, 'video'\)/)
  assert.match(src, /t\.status !== 'processing' && t\.status !== 'pending'/)
})

test('index：启动时挂上看门狗', () => {
  const src = read('src/index.ts')
  assert.match(src, /import \{ startAssetWatchdog \} from '\.\/services\/asset-watchdog\.js'/)
  assert.match(src, /startAssetWatchdog\(\)/)
})

test('前端：生产进度卡片展示每集视频生成中数量', () => {
  const src = readDetailSources(new URL('../frontend/', root))
  assert.match(src, /ep\.videos_generating/)
  assert.match(src, /个视频正在生成/)
  // 样式已外置到独立 CSS（降低单文件行数）
  const css = read('../frontend/app/assets/styles/drama.detail.css')
  assert.match(css, /\.prod-ep-vgen/)
})
