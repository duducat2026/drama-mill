import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readEpisodeRouteSources } from './helpers/episode-route-sources.mjs'
import { readSchemaSources } from './helpers/schema-sources.mjs'
import { readMysqlSchemaSources } from './helpers/mysql-schema-sources.mjs'
import { readAgentsIndexSources } from './helpers/agents-index-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const exists = (path) => existsSync(new URL(path, root))

test('backend removes the voice assignment agent and tools', () => {
  const agents = readAgentsIndexSources(root)
  const skills = read('src/agents/skills.ts')

  assert.doesNotMatch(agents, /voice_assigner/)
  assert.doesNotMatch(agents, /createVoiceTools/)
  assert.doesNotMatch(skills, /voice_assigner/)
  assert.equal(exists('src/agents/tools/voice-tools.ts'), false)
  assert.equal(exists('workspace/skills/voice_assigner/SKILL.md'), false)
})

test('backend removes audio service providers, TTS adapters, and voice routes', () => {
  const index = read('src/index.ts')
  const ai = read('src/services/ai.ts')
  const registry = read('src/services/adapters/registry.ts')
  const types = read('src/services/adapters/types.ts')

  assert.doesNotMatch(index, /aiVoices/)
  assert.doesNotMatch(ai, /audio/)
  assert.doesNotMatch(ai, /getAudioConfig/)
  assert.doesNotMatch(registry, /TTS/)
  assert.doesNotMatch(registry, /minimax-tts/)
  assert.doesNotMatch(types, /TTSProviderAdapter/)
  assert.equal(exists('src/routes/aiVoices.ts'), false)
  assert.equal(exists('src/services/tts-generation.ts'), false)
  assert.equal(exists('src/services/adapters/minimax-tts.ts'), false)
  assert.match(read('src/services/adapters/volcengine-video.ts'), /generate_audio:\s*record\.generateAudio/)
  assert.doesNotMatch(read('src/services/adapters/volcengine-video.ts'), /generate_audio:\s*false/)
})

test('backend removes TTS endpoints and audio-specific schema fields', () => {
  const episodes = readEpisodeRouteSources(root)
  const storyboards = read('src/routes/storyboards.ts')
  const characters = read('src/routes/characters.ts')
  const schema = readSchemaSources(root)
  const mysqlSchema = readMysqlSchemaSources(root)

  assert.doesNotMatch(episodes, /audio_config_id/)
  assert.doesNotMatch(episodes, /assign_voices/)
  assert.doesNotMatch(episodes, /generate_voice_samples/)
  assert.doesNotMatch(storyboards, /generate-tts/)
  assert.doesNotMatch(storyboards, /ttsAudioUrl/)
  assert.doesNotMatch(characters, /generate-voice-sample/)
  assert.doesNotMatch(characters, /voiceStyle/)
  assert.doesNotMatch(schema, /audioConfigId/)
  assert.doesNotMatch(schema, /voiceStyle/)
  assert.doesNotMatch(schema, /voiceSampleUrl/)
  assert.doesNotMatch(schema, /voiceProvider/)
  assert.doesNotMatch(schema, /ttsAudioUrl/)
  assert.doesNotMatch(schema, /aiVoices/)
  assert.doesNotMatch(mysqlSchema, /audio_config_id/)
  assert.doesNotMatch(mysqlSchema, /voice_style/)
  assert.doesNotMatch(mysqlSchema, /voice_sample_url/)
  assert.doesNotMatch(mysqlSchema, /voice_provider/)
  assert.doesNotMatch(mysqlSchema, /tts_audio_url/)
  // 无 ai_voices 表定义与清理逻辑（历史表不再兼容）
  assert.doesNotMatch(mysqlSchema, /CREATE TABLE IF NOT EXISTS ai_voices/)
  assert.doesNotMatch(mysqlSchema, /ai_voices/)
})
