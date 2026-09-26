import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readEpisodeRouteSources } from './helpers/episode-route-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('POST /episodes auto-locks configs when not provided', () => {
  const route = readEpisodeRouteSources(root)
  // 建集核心逻辑已抽到 episode-create 服务（路由与小说拆分共用）
  const svc = read('src/services/episode-create.ts')
  const ai = read('src/services/ai.ts')

  // 不再强制要求 config id
  assert.doesNotMatch(route, /image_config_id and video_config_id are required/)
  // 通过 getActiveConfigId 自动锁定
  assert.match(svc, /getActiveConfigId\('image'/)
  assert.match(svc, /getActiveConfigId\('video'/)
  // ai.ts 提供 getActiveConfigId
  assert.match(ai, /export async function getActiveConfigId/)
  // 找不到启用配置时给可操作的错误提示
  assert.match(svc, /未找到启用的图片生成配置/)
  assert.match(svc, /未找到启用的视频生成配置/)
})

test('POST /episodes still honors explicit config ids when caller passes them', () => {
  const svc = read('src/services/episode-create.ts')

  assert.match(svc, /imageConfigId \?\? await getActiveConfigId/)
  assert.match(svc, /videoConfigId \?\? await getActiveConfigId/)
})