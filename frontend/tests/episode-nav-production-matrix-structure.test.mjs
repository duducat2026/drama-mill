import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { episodeViewSource } from './helpers/episode-sources.mjs'
import { readDetailSources } from './helpers/detail-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('episode workbench exposes prev/next episode navigation', () => {
  const view = episodeViewSource()

  // 集号响应式：同路由记录切集时跟随路由参数刷新数据
  assert.match(view, /const episodeNumber = ref\(Number\(route\.params\.episodeNumber\)\)/)
  assert.match(view, /watch\(\(\) => route\.params\.episodeNumber/)

  // 上下集按钮：按剧集实际顺序取相邻集（集号可能不连续）
  assert.match(view, /studio-episode-nav/)
  assert.match(view, /prevEpisode/)
  assert.match(view, /nextEpisode/)
  assert.match(view, /episodeSequence/)
  assert.match(view, /goEpisodeWorkbench\(ep\)/)
  assert.match(view, /navigateTo\(`\/drama\/\$\{dramaId\}\/episode\/\$\{epNumberOf\(ep\)\}`\)/)

  // 面板位置记忆键跟随集号（computed），切集后落到新集
  assert.match(view, /PANEL_STORE_KEY = computed\(/)
})

test('episode prev/next nav has dedicated styles', () => {
  const css = read('app/assets/styles/episode.workbench.css')

  assert.match(css, /\.studio-episode-nav/)
  assert.match(css, /\.studio-epnav-btn/)
  assert.match(css, /\.studio-epnav-btn:disabled/)
})

test('production progress renders a 4-per-row episode card board', () => {
  const view = readDetailSources(root)

  // 阶段图例：编号 + 中文标签，与卡片内分段进度条顺序对应
  assert.match(view, /PROD_MATRIX_KEYS = PIPELINE_STEP_KEYS/)
  assert.match(view, /prod-legend-item/)
  assert.match(view, /prod-legend-idx/)
  // 每集一张卡：集号按钮 + 六段进度条 + 阶段摘要；计数走 tooltip 与摘要
  assert.match(view, /prod-ep-cell/)
  assert.match(view, /prod-ep-bar/)
  assert.match(view, /prod-seg-\$\{epStepStatus\(ep\.steps, s\)\}/)
  assert.match(view, /stepCountText\(ep\.steps, s\)/)
  assert.match(view, /function stepCountText/)
  assert.match(view, /function epStepSummary/)
  assert.match(view, /prod-ep-summary/)
  assert.match(view, /goEpisodeWorkbench\(ep\.episode_number\)/)
  // 步骤标签覆盖后端旧键集（角色/场景/分镜/图片）
  assert.match(view, /extract_characters: '角色提取'/)
  assert.match(view, /extract_scenes: '场景提取'/)
  assert.match(view, /extract_storyboards: '分镜拆分'/)
  assert.match(view, /generate_images: '素材图片'/)
})

test('production progress board uses a 4-column grid with responsive fallback', () => {
  const css = read('app/assets/styles/drama.detail.css')

  // 一行 4 集；窄屏降级 2 列/1 列
  assert.match(css, /\.prod-eps \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/)
  assert.match(css, /max-width: 1080px\) \{ \.prod-eps \{ grid-template-columns: repeat\(2/)
  assert.match(css, /max-width: 620px\) \{ \.prod-eps \{ grid-template-columns: 1fr/)
  // 卡片内六段胶囊进度条 + 当前集高亮 + 进行中分段呼吸动画
  assert.match(css, /\.prod-ep-bar \{ display: grid; grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/)
  assert.match(css, /\.prod-seg-done/)
  assert.match(css, /\.prod-seg-partial/)
  assert.match(css, /\.prod-ep-cell\.current \{ border-color: var\(--accent\)/)
  assert.match(css, /@keyframes prodSegPulse/)
})
