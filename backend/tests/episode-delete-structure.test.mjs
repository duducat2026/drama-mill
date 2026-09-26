import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readEpisodeRouteSources } from './helpers/episode-route-sources.mjs'
import { readDramasRouteSources } from './helpers/dramas-route-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('episodes route exposes soft delete', () => {
  const route = readEpisodeRouteSources(root)

  assert.match(route, /app\.delete\('\/:id'/)
  assert.match(route, /set\(\{ deletedAt: now\(\)/)
  assert.match(route, /剧集不存在/)
  // 无硬删
  assert.doesNotMatch(route, /db\.delete\(schema\.episodes\)/)
})

test('drama queries exclude soft-deleted episodes', () => {
  const dramas = readDramasRouteSources(root)

  // 列表聚合与详情都过滤 deletedAt
  const matches = dramas.match(/isNull\(schema\.episodes\.deletedAt\)/g) || []
  assert.ok(matches.length >= 2, `expected >=2 deletedAt filters, got ${matches.length}`)
  // 新建集时下一集号也忽略软删集（建集逻辑已抽到 episode-create 服务）
  const episodes = read('src/services/episode-create.ts')
  assert.match(episodes, /isNull\(schema\.episodes\.deletedAt\)/)
})
