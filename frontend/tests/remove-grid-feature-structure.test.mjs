import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { episodeViewSource } from './helpers/episode-sources.mjs'
import { readUseApiSources } from './helpers/use-api-sources.mjs'
import { readSettingsSources } from './helpers/settings-page-sources.mjs'

const appRoot = new URL('../app/', import.meta.url)
const readApp = (path) => readFileSync(new URL(path, appRoot), 'utf8')

const episodePage = episodeViewSource()
const settingsPage = readSettingsSources(new URL('..', import.meta.url))
const adminAgentsPage = readApp('pages/admin/agents.vue')
const useApi = readUseApiSources(new URL('..', import.meta.url))

test('frontend API client no longer exposes grid image endpoints', () => {
  assert.doesNotMatch(useApi, /gridAPI/)
  assert.doesNotMatch(useApi, /\/grid\/prompt/)
  assert.doesNotMatch(useApi, /\/grid\/generate/)
  assert.doesNotMatch(useApi, /\/grid\/split/)
  assert.doesNotMatch(useApi, /\/grid\/status/)
})

test('episode workbench removes the grid image tool and history UI', () => {
  assert.doesNotMatch(episodePage, /宫格图/)
  assert.doesNotMatch(episodePage, /openGridTool/)
  assert.doesNotMatch(episodePage, /gridDialog/)
  assert.doesNotMatch(episodePage, /gridAPI/)
  assert.doesNotMatch(episodePage, /generateGridPrompt/)
  assert.doesNotMatch(episodePage, /startGridGen/)
  assert.doesNotMatch(episodePage, /doGridSplit/)
  assert.doesNotMatch(episodePage, /latest-grid-strip/)
  assert.doesNotMatch(episodePage, /grid-history/)
})

test('settings image prompt agent copy only describes role and scene prompts', () => {
  // Agent 配置已迁至管理后台（前台不可见），断言对象改为 admin/agents.vue
  assert.match(adminAgentsPage, /prompt_generator/)
  assert.doesNotMatch(settingsPage, /宫格图/)
  assert.doesNotMatch(adminAgentsPage, /宫格图/)
  assert.doesNotMatch(adminAgentsPage, /read_shots_for_grid/)
  assert.doesNotMatch(adminAgentsPage, /generate_grid_prompt/)
  assert.doesNotMatch(adminAgentsPage, /grid_prompt（/)
  assert.doesNotMatch(adminAgentsPage, /cell_prompts/)
})
