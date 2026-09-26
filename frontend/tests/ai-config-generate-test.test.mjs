import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readUseApiSources } from './helpers/use-api-sources.mjs'
import { readSettingsSources } from './helpers/settings-page-sources.mjs'

const settingsPage = readSettingsSources(new URL('..', import.meta.url))
const useApi = readUseApiSources(new URL('..', import.meta.url))
const settingsCss = readFileSync(new URL('../app/assets/styles/settings.css', import.meta.url), 'utf8')

test('useApi exposes generate-test endpoint for saved configs', () => {
  assert.match(useApi, /generateTest: \(id: number\) => api\.post[\s\S]*?\/ai-configs\/\$\{id\}\/generate-test/)
})

test('settings page: 三类配置都有生成测试入口且尊重启用态与总开关', () => {
  // 每类配置的每一行都渲染「生成测试」按钮（不再限 text）
  assert.match(settingsPage, /@click="runGenerateTest\(c\)"/)
  assert.match(settingsPage, />生成测试</)
  // 未启用配置禁用按钮，并给出可读提示
  assert.match(settingsPage, /:disabled="!c\.is_active \|\| genTest\.busy"/)
  // 原连通性测试保留为「连通」，仅文本
  assert.match(settingsPage, /@click="testExistingCfg\(c\)">连通</)

  // 前端遵守模型调用总开关：关闭时不发请求
  assert.match(settingsPage, /if \(!aiCallEnabled\.value\)[\s\S]*?模型调用总开关已关闭/)
  // 未启用配置拒绝发起
  assert.match(settingsPage, /if \(!c\.is_active\)[\s\S]*?请先启用该配置/)
})

test('settings page: 文本同步展示、图片/视频轮询任务并预览产物', () => {
  // 文本走同步结果，图片/视频走 task_id 轮询（轮次令牌 + 起始时间随参数下传）
  assert.match(settingsPage, /if \(res\.service_type === 'text'\) \{/)
  assert.match(settingsPage, /pollGenTestTask\(res\.task_id, Date\.now\(\), round\)/)
  // 轮询 /tasks/:id，处理 completed / failed / 继续等待
  assert.match(settingsPage, /await taskAPI\.get\(taskId\)/)
  assert.match(settingsPage, /t\?\.status === 'completed'/)
  assert.match(settingsPage, /t\?\.status === 'failed'/)
  assert.match(settingsPage, /t\.localPath \|\| t\.resultUrl/)
  // 相对路径补前导斜杠，绝对/数据 URL 原样
  assert.match(settingsPage, /\/\^\(https\?:\|data:\|blob:\|\\\/\)\/\.test\(p\)/)
  // 结果预览：文本 / 图片 / 视频分别渲染
  assert.match(settingsPage, /class="gen-test-text-body"/)
  assert.match(settingsPage, /<img :src="genTest\.mediaUrl"/)
  assert.match(settingsPage, /<video :src="genTest\.mediaUrl"/)
  // 关闭弹层与组件卸载都会停止轮询，避免悬挂定时器
  assert.match(settingsPage, /function closeGenerateTest\(\) \{ stopGenTestPoll\(\)/)
  assert.match(settingsPage, /onBeforeUnmount\(stopGenTestPoll\)/)
})

test('settings page: 生成测试轮询有界且旧回包不能改写新一轮状态', () => {
  // 客户端上限（后端已对测试任务挂有限墙钟，这里只兜底任务行异常停留）
  assert.match(settingsPage, /const GEN_TEST_POLL_MAX_MS = \d+ \* 60_000/)
  assert.match(settingsPage, /if \(Date\.now\(\) - startedAt > GEN_TEST_POLL_MAX_MS\)/)
  // 轮次令牌：关闭重开/换配置再测后，上一轮的在途回包直接丢弃
  assert.match(settingsPage, /let genTestRound = 0/)
  assert.match(settingsPage, /const round = \+\+genTestRound/)
  assert.match(settingsPage, /if \(round !== genTestRound\) return\n\s*\/\/ 失败按 200 \+ ok:false/)
  assert.match(settingsPage, /if \(res\.service_type === 'text'\)/)
  assert.match(settingsPage, /const t = await taskAPI\.get\(taskId\)\n\s*if \(round !== genTestRound\) return/)
  // 生成中不允许再次提交（连点会重复付费）
  assert.match(settingsPage, /async function runGenerateTest\(c\) \{\n\s*if \(genTest\.busy\) return/)
  assert.match(settingsPage, /:disabled="!c\.is_active \|\| genTest\.busy"/)
  // 关闭弹层同时复位进行态并换轮次，避免残留 spinner
  assert.match(settingsPage, /closeGenerateTest\(\) \{ stopGenTestPoll\(\); genTestRound\+\+; genTest\.busy = false/)
})

test('settings page: 弹层提示真实计价', () => {
  assert.match(settingsPage, /真实的模型调用/)
  assert.match(settingsPage, /class="gen-test-cost"/)
  assert.match(settingsCss, /\.gen-test-cost \{/)
})
