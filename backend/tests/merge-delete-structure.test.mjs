import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { episodeViewSource } from '../../frontend/tests/helpers/episode-sources.mjs'
import { readUseApiSources } from '../../frontend/tests/helpers/use-api-sources.mjs'

const mergeRoute = readFileSync(new URL('../src/routes/merge.ts', import.meta.url), 'utf8')
const useApi = readUseApiSources(new URL('../../frontend/', import.meta.url))
const episodeView = episodeViewSource()

test('user-side merge delete: backend route, frontend api and episode view wiring', () => {
  // 后端：DELETE 接口 + 归属校验 + 拼接中拦截 + 软删 + 物理文件清理 + 剧集引用解除
  assert.match(mergeRoute, /app\.delete\('\/episodes\/:id\/merges\/:mergeId'/)
  assert.match(mergeRoute, /getEpisodeOwned\(episodeId, user\)/)
  assert.match(mergeRoute, /拼接进行中，请完成后再删除/)
  assert.match(mergeRoute, /deletedAt: now\(\)/)
  assert.match(mergeRoute, /posterPathFor\(merge\.mergedUrl\)/)
  assert.match(mergeRoute, /videoUrl: null/)
  // 最新拼接状态接口过滤已删除成片，避免删除后仍返回失效记录
  assert.match(mergeRoute, /isNull\(schema\.videoMerges\.deletedAt\)/)

  // 前端：mergeAPI.remove 与导出页删除入口、确认弹窗
  assert.match(useApi, /remove: \(epId: number, mergeId: number\) => api\.del\(`\/merge\/episodes\/\$\{epId\}\/merges\/\$\{mergeId\}`\)/)
  assert.match(episodeView, /askDeleteMerge\(m\)/)
  assert.match(episodeView, /confirmDeleteMerge/)
  assert.match(episodeView, /mergeAPI\.remove\(epId\.value, m\.id\)/)
  assert.match(episodeView, /title="删除成片"/)
})
