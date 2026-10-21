import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readAiConfigRouteSources } from './helpers/aiconfig-route-sources.mjs'

const root = new URL('../..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const exists = (path) => existsSync(new URL(path, root))

test('MiniMax is offered for video generation only', () => {
  const ai = read('backend/src/services/ai.ts')
  const route = readAiConfigRouteSources(new URL('backend/', root))
  const registry = read('backend/src/services/adapters/registry.ts')
  // 服务商预设已从 settings.vue 抽到 useAiConfigs composable
  const settings = read('frontend/app/composables/settings/useAiConfigs.js')

  // 视频：MiniMax H3 官方入口恢复
  assert.match(ai, /video:\s*\[[^\]]*'minimax'/)
  assert.match(route, /p === 'minimax'/i)
  assert.match(registry, /minimax:\s*new MiniMaxVideoAdapter\(\)/)
  assert.equal(exists('backend/src/services/adapters/minimax-video.ts'), true)
  assert.match(settings, /MiniMax-H3/)

  // 图片与音频不提供 MiniMax
  assert.doesNotMatch(ai, /image:\s*\[[^\]]*'minimax'/)
  assert.doesNotMatch(registry, /minimax:\s*new MiniMaxImageAdapter/)
  assert.equal(exists('backend/src/services/adapters/minimax-image.ts'), false)
  assert.equal(exists('backend/src/services/adapters/minimax-tts.ts'), false)
  assert.doesNotMatch(registry, /minimax-tts/)
})

test('legacy MiniMax cleanup statements are removed with provider return', () => {
  const mysqlSchema = read('backend/src/db/mysql-schema.ts')

  // 厂商回归后，启动时的 MiniMax 配置清理逻辑已移除
  assert.doesNotMatch(mysqlSchema, /mysqlDataCleanupStatements/)
  assert.doesNotMatch(mysqlSchema, /DELETE FROM `ai_service_configs` WHERE `provider` = \?/)
  assert.doesNotMatch(mysqlSchema, /params:\s*\['minimax'\]/)
})
