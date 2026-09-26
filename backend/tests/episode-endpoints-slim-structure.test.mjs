import { readMigrationsSources } from './helpers/migrations-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readEpisodeRouteSources } from './helpers/episode-route-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('episode asset endpoints push WHERE down to SQL instead of full-table scan', () => {
  const route = readEpisodeRouteSources(root)

  // 角色/场景/道具按 id 集合 + 软删过滤下推
  assert.match(route, /inArray\(schema\.characters\.id, charIds\)/)
  assert.match(route, /inArray\(schema\.scenes\.id, sceneIds\)/)
  assert.match(route, /inArray\(schema\.props\.id, propIds\)/)
})

test('episode storyboards response carries only ids, not nested asset objects', () => {
  const route = readEpisodeRouteSources(root)

  // 链接表按分镜 id 集合查询
  assert.match(route, /inArray\(schema\.storyboardCharacters\.storyboardId, sbIds\)/)
  assert.match(route, /inArray\(schema\.storyboardProps\.storyboardId, sbIds\)/)
  // 每分镜只带 id 数组
  assert.match(route, /character_ids: charIdsByStoryboard\.get\(row\.id\)/)
  assert.match(route, /prop_ids: propIdsByStoryboard\.get\(row\.id\)/)
})

test('episode generation-tasks endpoint paginates with SQL conditions', () => {
  const route = readEpisodeRouteSources(root)

  // 关联键收集后以 inArray 下推（非空才拼条件）
  assert.match(route, /inArray\(schema\.sysTask\.storyboardId, storyboardIds\)/)
  // 分页响应
  assert.match(route, /total_pages: Math\.ceil\(total \/ pageSize\)/)
})

test('migrations add indexes for high-frequency list queries', () => {
  const migrations = readMigrationsSources(root)

  for (const idx of [
    'idx_episodes_drama_id',
    'idx_characters_drama_id',
    'idx_scenes_drama_id',
    'idx_props_drama_id',
    'idx_storyboards_episode_id',
    'idx_video_merges_episode_id',
  ]) {
    assert.ok(migrations.includes(idx), `missing index ${idx}`)
  }
  // 幂等：ensureIndex 先查 SHOW INDEX 再 ALTER
  assert.match(migrations, /async function ensureIndex/)
  assert.match(migrations, /SHOW INDEX/)
})

test('pipeline status selects slim boolean columns instead of full script text', () => {
  const service = read('src/services/pipeline-status.ts')

  assert.match(service, /CASE WHEN script_content IS NOT NULL/)
  assert.match(service, /CASE WHEN content IS NOT NULL/)
})
