import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readEpisodeRouteSources } from './helpers/episode-route-sources.mjs'

const mergeService = readFileSync(new URL('../src/services/ffmpeg-merge.ts', import.meta.url), 'utf8')
const episodesRoute = readEpisodeRouteSources(new URL('..', import.meta.url))
const backendIndex = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
const useApi = readFileSync(new URL('../../frontend/app/composables/useApi.ts', import.meta.url), 'utf8')
const composeRoutePath = new URL('../src/routes/compose.ts', import.meta.url)
const composeServicePath = new URL('../src/services/ffmpeg-compose.ts', import.meta.url)

test('episode merge uses generated videos directly without requiring compose output', () => {
  assert.doesNotMatch(mergeService, /Only composed storyboards can be merged/)
  assert.match(mergeService, /sb\.videoUrl\s*\|\|\s*sb\.composedVideoUrl/)
  // 允许部分拼接：跳过未生成镜头，全部缺失时报错；丢失文件提前拦截
  assert.match(mergeService, /所选镜头还没有可拼接的视频/)
  assert.match(mergeService, /视频文件已丢失/)
})

test('merge 记录 title 取本集真实标题，不写内部占位串', () => {
  // `Episode {episodeId} Merge` 用主键当集号，且随接口下发前端参与成片下载命名，导致文件名出现 Episode 37
  assert.doesNotMatch(mergeService, /Episode \$\{episodeId\} Merge/)
  assert.match(mergeService, /db\.select\(\{ title: schema\.episodes\.title \}\)/)
  assert.match(mergeService, /title: ep\?\.title \|\| null/)
})

test('compose workflow is no longer exposed through API surfaces', () => {
  assert.doesNotMatch(episodesRoute, /compose_shots/)
  assert.doesNotMatch(backendIndex, /api\.route\('\/compose'/)
  assert.doesNotMatch(useApi, /export const composeAPI/)
  assert.equal(existsSync(composeRoutePath), false)
  assert.equal(existsSync(composeServicePath), false)
})

// fluent-ffmpeg 2.1.3 在 Node ≥22 上子进程异常退出时会因 stdoutRing/stderrRing
// 未初始化直接崩掉进程（库内部回调，外层接不住），热路径必须直跑 ffmpeg
const ffmpegUtil = readFileSync(new URL('../src/utils/ffmpeg.ts', import.meta.url), 'utf8')
const posterService = readFileSync(new URL('../src/utils/video-poster.ts', import.meta.url), 'utf8')

test('ffmpeg utils: hot paths bypass fluent-ffmpeg via direct spawn', () => {
  assert.match(ffmpegUtil, /export function runFfmpeg/)
  assert.match(ffmpegUtil, /export function runFfprobe/)
  // 海报帧与拼接均不再经过 fluent-ffmpeg（避免进程级崩溃），失败可被捕获降级/落库
  assert.match(posterService, /runFfmpeg\(/)
  assert.doesNotMatch(posterService, /screenshots\(/)
  assert.match(mergeService, /runFfmpeg\(/)
  assert.match(mergeService, /runFfprobe\(/)
  assert.doesNotMatch(mergeService, /ffmpeg\.ffprobe/)
  assert.doesNotMatch(mergeService, /\.run\(\)/)
})
