import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSchemaSources } from './helpers/schema-sources.mjs'
import { readMysqlSchemaSources } from './helpers/mysql-schema-sources.mjs'
import { readAgentsIndexSources } from './helpers/agents-index-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('characters and scenes tables store the agent-written final prompt', () => {
  const schema = readSchemaSources(root)
  const mysql = readMysqlSchemaSources(root)

  // Drizzle 表定义
  assert.match(schema, /export const characters = mysqlTable\('characters'[\s\S]*?finalPrompt: text\('final_prompt'\)/)
  assert.match(schema, /export const scenes = mysqlTable\('scenes'[\s\S]*?finalPrompt: text\('final_prompt'\)/)
  // 字段直接包含在 CREATE TABLE 中（无需存量 backfill）
  assert.match(mysql, /CREATE TABLE IF NOT EXISTS characters \([\s\S]*?final_prompt TEXT/)
  assert.match(mysql, /CREATE TABLE IF NOT EXISTS scenes \([\s\S]*?final_prompt TEXT/)
})

test('grid prompt agent tools save agent-written final prompts with style injection', () => {
  const tools = read('src/agents/tools/image-prompt-tools.ts')

  assert.match(tools, /save_character_final_prompt/)
  assert.match(tools, /save_scene_final_prompt/)
  // 保存时注入项目视觉风格并落库
  assert.match(tools, /getDramaStylePrompt/)
  assert.match(tools, /set\(\{ finalPrompt, updatedAt: now\(\) \}\)/)
  // 提示词由 Agent 创作，不再由工具机械拼接
  assert.doesNotMatch(tools, /generate_character_prompt/)
  assert.doesNotMatch(tools, /generate_scene_prompt/)
})

test('prompt agent instructions reference per-asset skills; skill files define the specs', () => {
  const agents = readAgentsIndexSources(root)
  const charSkill = read('workspace/skills/prompt-generator/character-prompt/SKILL.md')
  const sceneSkill = read('workspace/skills/prompt-generator/scene-prompt/SKILL.md')

  // 三类图片规范入口在后端 Agent 指令中（具体创作规则在各自 SKILL.md 中）
  assert.match(agents, /角色走三视图/)
  assert.match(agents, /场景走固定视角/)
  assert.match(agents, /道具走白底单品/)
  // 保存工具约定
  assert.match(agents, /save_character_final_prompt/)
  assert.match(agents, /save_scene_final_prompt/)
  // 角色三视图 / 场景固定视角的必备要素由技能文件承载（纯中文输出）
  assert.match(charSkill, /脸部特写/)
  assert.match(charSkill, /正面、90° 侧身、背面/)
  assert.match(charSkill, /特写与三个全身像的脸、头发、衣着完全一致/)
  assert.match(charSkill, /纯中文/)
  assert.match(sceneSkill, /固定机位广角/)
  assert.match(sceneSkill, /前景\[框景元素\]、中景\[主体空间\]、后景\[纵深延伸\]/)
  assert.match(sceneSkill, /出入口/)
  assert.match(sceneSkill, /纯中文/)
})

test('image generation prefers the stored final prompt with agent generation and legacy fallback', () => {
  const service = read('src/services/final-prompt.ts')
  const characters = read('src/routes/characters.ts')
  const scenes = read('src/routes/scenes.ts')
  const assetImages = read('src/services/asset-images.ts')

  assert.match(service, /export async function ensureCharacterFinalPrompt/)
  assert.match(service, /export async function ensureSceneFinalPrompt/)
  assert.match(service, /getAgent\('prompt_generator'/)
  // 已有最终提示词直接复用（force 时忽略强制重新生成）
  assert.match(service, /if \(char\.finalPrompt && !force\) return char\.finalPrompt/)
  assert.match(service, /if \(scene\.finalPrompt && !force\) return scene\.finalPrompt/)
  assert.match(service, /force = false/)

  assert.match(characters, /ensureCharacterFinalPrompt\(char, ep\.id, /)
  // 文本模型覆盖（text_model/text_config_id）透传到提示词 Agent
  assert.match(characters, /text_model/)
  // 生图时优先用最终提示词，缺失回退机械拼接（在统一生图服务中）
  assert.match(assetImages, /finalPrompt \|\| characterImagePrompt\(char, stylePrompt\)/)
  assert.match(scenes, /ensureSceneFinalPrompt\(scene, ep\.id, /)
  // 最终提示词手动编辑：传入即以传入值为准
  assert.match(characters, /if \(body\.final_prompt !== undefined\) updates\.finalPrompt = body\.final_prompt \|\| null/)
  assert.match(scenes, /if \(body\.final_prompt !== undefined\) updates\.finalPrompt = body\.final_prompt \|\| null/)
})
