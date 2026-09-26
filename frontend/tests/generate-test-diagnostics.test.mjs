// 生成测试失败诊断 + API Key 明文查看 — 结构测试（源码断言，沿用现有约定）
// 一次付费调用失败后，用户要能看到「为什么失败、改哪里、上游原话」，并能核对已保存的 Key
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readUseApiSources } from './helpers/use-api-sources.mjs'
import { readSettingsSources } from './helpers/settings-page-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const settingsPage = readSettingsSources(root)
const settingsCss = read('app/assets/styles/settings.css')
const useApi = readUseApiSources(root)

test('失败诊断：结构化渲染结论 / 建议 / 事实清单 / 上游原文', () => {
  assert.match(settingsPage, /const genTest = reactive\(\{[\s\S]*?error: '', detail: null \}\)/)
  // 后端 200 + ok:false 分支：不再靠 HTTP 400 的 message 兜整屏
  assert.match(settingsPage, /if \(res && res\.ok === false\) \{/)
  assert.match(settingsPage, /genTest\.error = res\.error\?\.summary \|\| '生成测试失败'/)
  // 四层展示各有其位
  assert.match(settingsPage, /class="gen-test-error-summary">\{\{ genTest\.error \}\}/)
  assert.match(settingsPage, /v-if="genTestErrInfo\?\.hint" class="gen-test-error-hint"/)
  assert.match(settingsPage, /v-for="f in genTestFacts" :key="f\.label" class="gen-test-fact"/)
  assert.match(settingsPage, /<pre class="gen-test-raw-body">\{\{ genTestErrInfo\.raw \}\}<\/pre>/)
  // 诊断信息可整份复制（含 request_id），便于直接找服务商
  assert.match(settingsPage, /@click="copyGenDiagnosis">/)
  assert.match(settingsPage, /诊断信息已复制，可直接发给服务商/)
  // 状态标签带分类，一眼看出是鉴权还是限流
  assert.match(settingsPage, /`失败 · \$\{genTestKindLabel\.value\}`/)
  assert.match(settingsCss, /\.gen-test-facts \{/)
  assert.match(settingsCss, /\.gen-test-raw-body \{/)
})

test('图片/视频任务失败：先显示原始 errorMsg，再补拉一次诊断且不许卡住', () => {
  // 轮询到 failed 立刻有内容可看，诊断是异步补强而非前置条件
  assert.match(settingsPage, /genTest\.error = t\.errorMsg \|\| '上游未返回失败原因'/)
  assert.match(settingsPage, /genTest\.detail = \{ task_id: taskId, loading: true, error: \{ hint: '', raw: t\.errorMsg \|\| '' \} \}/)
  assert.match(settingsPage, /loadTaskFailureDetail\(taskId, round\)/)
  assert.match(settingsPage, /await taskAPI\.failureDetail\(taskId\)/)
  // 补拉要过轮次令牌 + 任务号双校验，旧任务的回包不能改写新一轮
  assert.match(settingsPage, /if \(round !== genTestRound \|\| genTest\.detail\?\.task_id !== taskId\) return/)
  // 拉失败也要落 loading，否则弹层永远停在「正在拉取失败详情」
  assert.match(settingsPage, /genTest\.detail = \{ \.\.\.genTest\.detail, loading: false \}/)
  assert.match(useApi, /failureDetail: \(id: number\) => api\.get<any>\(`\/tasks\/\$\{id\}\/failure-detail`\)/)
})

test('失败时可手动再测一次：测试任务后台永不自动重提', () => {
  assert.match(settingsPage, /@click="retestGenerate">/)
  // 重新测试取当前列表里的最新配置值（用户可能刚改过 Key/模型）
  assert.match(settingsPage, /const c = cfgs\.value\.find\(x => x\.id === genTest\.configId\)/)
  // 配置可能已被删/无权访问时不能静默重发
  assert.match(settingsPage, /if \(!c\) \{ toast\.error\('该配置已被删除或无权访问'\); closeGenerateTest\(\); return \}/)
  assert.match(settingsPage, /runGenerateTest\(c\)/)
})

test('API Key 支持点击明文查看，进入独立配置页时回到密文', () => {
  assert.match(settingsPage, /import \{.*Eye, EyeOff, Copy.*\} from 'lucide-vue-next'/)
  assert.match(settingsPage, /const apiKeyVisible = ref\(false\)/)
  assert.match(settingsPage, /:type="apiKeyVisible \? 'text' : 'password'"/)
  assert.match(settingsPage, /@click="apiKeyVisible = !apiKeyVisible"/)
  // 明文态等宽字体，复制键只在已有值时出现
  assert.match(settingsPage, /class="input affix-input mono"/)
  assert.match(settingsPage, /v-if="cfgForm\.api_key" type="button" class="affix-btn" title="复制密钥"/)
  // 两个入口都复位，避免上一次明文状态残留
  assert.match(settingsPage, /async function loadCfgEditor\(\) \{[\s\S]*?apiKeyVisible\.value = false/)
  assert.match(settingsPage, /definePageMeta\(\{ key: route => route\.path \}\)/)
  assert.match(settingsPage, /if \(cfgPage\.value\) loadCfgEditor\(\)/)
  // 列表行只给掩码尾号，完整值仍须进弹窗
  assert.match(settingsPage, /\{\{ maskKey\(c\.api_key\) \}\}/)
  assert.match(settingsCss, /\.input-affix \{/)
  assert.match(settingsCss, /\.affix-btn \{/)
})

test('文本成功但正文为空：显式标注空正文并给出可读原因', () => {
  // 思考型模型会把内容放进 reasoning_content，旧版显示空白区块，用户以为「测试通过却什么都没发生」
  assert.match(settingsPage, /class="gen-test-text-body" :class="\{ 'is-empty': !genTest\.text \}">\{\{ genTest\.text \|\| '（正文为空）' \}\}/)
  // note 只由后端 empty_note 驱动，且必须在复位里一起清空
  assert.match(settingsPage, /const genTest = reactive\(\{[\s\S]*?mediaUrl: '', note: '', error: ''/)
  assert.match(settingsPage, /text: '', elapsed: 0, mediaUrl: '', note: '', error: '', detail: null,/)
  assert.match(settingsPage, /genTest\.note = res\.empty_note \|\| ''/)
  assert.match(settingsPage, /v-if="genTest\.note" class="gen-test-note"/)
  assert.match(settingsCss, /\.gen-test-text-body\.is-empty \{/)
  assert.match(settingsCss, /\.gen-test-note \{/)
})

test('API Key 相关文案不承诺错误的安全性', () => {
  // 只说「其他用户看不到」，不写「永不泄露/绝对安全」这类做不到的保证
  assert.match(settingsPage, /配置只归属本人，其他用户在列表里看不到这条/)
  assert.doesNotMatch(settingsPage, /密钥绝不外泄|绝对安全/)
})
