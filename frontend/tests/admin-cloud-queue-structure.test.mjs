import { readAdminSources } from '../../backend/tests/helpers/admin-sources.mjs'
import { readTasksRouteSources } from '../../backend/tests/helpers/tasks-route-sources.mjs'
import { readCloudTasksSources } from '../../backend/tests/helpers/cloud-tasks-sources.mjs'
import { readUseApiSources } from './helpers/use-api-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const frontendRoot = new URL('..', import.meta.url)
const backendRoot = new URL('../../backend/', import.meta.url)
const read = (root, path) => readFileSync(new URL(path, root), 'utf8')

test('CloudQueuePanel renders stats and comparison tables (shared by both sides)', () => {
  const panel = read(frontendRoot, 'app/components/CloudQueuePanel.vue')

  // 概览指标卡：云端排队/在途 + 本地在途 + 三类比对计数
  assert.match(panel, /云端排队（PENDING）/)
  assert.match(panel, /云端在途（RUNNING）/)
  assert.match(panel, /data\.local\.matched/)
  assert.match(panel, /data\.cloud_only_total/)

  // 三张比对表：匹配 / 本地有云端无 / 云端有本地无
  assert.match(panel, /匹配任务 · /)
  assert.match(panel, /本地有 \/ 云端无/)
  assert.match(panel, /云端有 \/ 本地无/)
  assert.match(panel, /cloudOnlyShown/)

  // 云端陌生任务明细默认隐藏（用户侧），由 showCloudOnly 控制
  assert.match(panel, /showCloudOnly\?: boolean/)
  assert.match(panel, /showCloudOnly: false/)
  assert.match(panel, /v-if="showCloudOnly && data\.cloud_only/)

  // 异常提示：云端查询失败与截断提示
  assert.match(panel, /云端查询失败/)
  assert.match(panel, /data\?\.cloud\?\.truncated/)

  // 多模型分流：逐池在途明细（仅多池时展示），指标卡副文案标注「合计」防误读为单池数字
  assert.match(panel, /const poolBreakdown = computed\(\(\) => props\.data\?\.cloud\?\.by_model \|\| \[\]\)/)
  assert.match(panel, /v-if="poolBreakdown\.length > 1"/)
  assert.match(panel, /模型池明细/)
  assert.match(panel, /个模型池合计/)
})

test('admin page uses shared panel with full cloud_only details', () => {
  const page = read(frontendRoot, 'app/pages/admin/cloud-queue.vue')

  assert.match(page, /definePageMeta\(\{ layout: 'admin' \}\)/)
  // adminAPI 经 useApi 门面 `export *` 再导出，Nuxt 自动导入不覆盖：页面必须显式 import，否则运行时 ReferenceError
  assert.match(page, /import \{ adminAPI \} from '~\/composables\/useApi'/)
  assert.match(page, /adminAPI\.cloudQueue\(/)
  assert.match(page, /查询云端/)
  assert.match(page, /params\.model = modelInput\.value\.trim\(\)/)
  // 用户选择器：选用户后加载该用户的视频配置（模型 + API-KEY）查询
  assert.match(page, /v-model="userIdInput"/)
  assert.match(page, /adminAPI\.users\(/)
  assert.match(page, /params\.user_id = userIdInput\.value/)
  // 模型清单随所选账号自动带出：切换账号拉取其启用的视频配置模型并重置已选模型；
  // 全部用户（默认配置）时不带 user_id，与查询侧配置解析口径一致
  assert.match(page, /watch\(userIdInput/)
  assert.match(page, /adminAPI\.aiConfigs\(params\)/)
  assert.match(page, /service_type: 'video'/)
  assert.match(page, /if \(userIdInput\.value\) params\.user_id = userIdInput\.value/)
  assert.match(page, /v-for="m in modelOptions"/)
  assert.match(page, /模型（默认配置模型）/)
  // 管理侧展示云端有/本地无明细
  assert.match(page, /<CloudQueuePanel v-if="data" :data="data" show-cloud-only \/>/)
  // 管理侧展示配置信息（掩码后的 Key）与查询口径模型清单（多池时列出全部模型）
  assert.match(page, /data\.config\.api_key/)
  assert.match(page, /modelSummary/)
  assert.match(page, /data\.value\?\.models\?\.length > 1 \? data\.value\.models\.join\('、'\) : data\.value\?\.model/)

  const layout = read(frontendRoot, 'app/layouts/admin.vue')
  assert.match(layout, /path: '\/admin\/cloud-queue'/)
  assert.match(layout, /ListOrdered/)
})

test('user page uses shared panel scoped to own tasks, with user nav entry', () => {
  const page = read(frontendRoot, 'app/pages/cloud-queue.vue')

  // 用户侧走普通任务接口，且不展示云端陌生任务明细（无 show-cloud-only）
  assert.match(page, /taskAPI\.cloudQueue\(/)
  assert.match(page, /<CloudQueuePanel v-if="data" :data="data" \/>/)
  assert.doesNotMatch(page, /show-cloud-only/)
  assert.match(page, /查询云端/)
  assert.match(page, /本地在途仅统计你的任务/)
  // 用户侧展示本人查询配置（掩码后的 Key）与查询口径模型清单，确认与提交任务所用 Key 一致
  assert.match(page, /data\.config\.api_key/)
  assert.match(page, /modelSummary/)

  // 用户顶部导航入口
  const layout = read(frontendRoot, 'app/layouts/default.vue')
  assert.match(layout, /to="\/cloud-queue"/)
  assert.match(layout, /ListOrdered/)

  // API 接线：用户侧与管理侧各自独立；管理侧支持 user_id 参数
  const api = readUseApiSources(frontendRoot)
  assert.match(api, /cloudQueue: .*api\.get\(`\/admin\/cloud-queue/)
  assert.match(api, /user_id\?: number/)
  assert.match(api, /api\.get<any>\(`\/tasks\/cloud-queue/)
})

test('backend admin cloud-queue masks key and returns full comparison', () => {
  const admin = readAdminSources(backendRoot)

  assert.match(admin, /app\.get\('\/cloud-queue'/)
  // 支持按用户查询：加载该用户的视频配置（模型 + API-KEY）
  assert.match(admin, /c\.req\.query\('user_id'\)/)
  assert.match(admin, /resolveCloudQueryTarget\(/)
  // 指定用户时本地比对限定该用户（本人提交 + 自有项目）
  assert.match(admin, /or\(eq\(schema\.sysTask\.userId, userId\), inArray\(schema\.sysTask\.dramaId, ids\)\)/)
  // api_key 掩码防泄露；配置/模型解析与比对走共享服务
  assert.match(admin, /maskApiKey\(cfg\.apiKey\)/)
  assert.match(admin, /compareLocalWithCloud\(cloud\.byTaskId, localRows\)/)
  // 本地在途限量拉取，防全表加载
  assert.match(admin, /\.limit\(500\)/)
  // 三类比对结果均返回，并回显查询用户
  assert.match(admin, /user: userInfo/)
  assert.match(admin, /matched: cmp\.matched/)
  assert.match(admin, /local_only: cmp\.localOnly/)
  assert.match(admin, /cloud_only: cmp\.cloudOnly/)
})

test('backend user cloud-queue uses own config and scopes to owner', () => {
  const tasks = readTasksRouteSources(backendRoot)

  assert.match(tasks, /app\.get\('\/cloud-queue'/)
  // 必须注册在 /:id 之前，避免被参数路由截胡
  assert.ok(tasks.indexOf("app.get('/cloud-queue'") < tasks.indexOf("app.get('/:id'"))
  // 用本人视频配置（模型 + API-KEY）查询，与提交任务所用 Key 一致；返回掩码后的本人配置
  assert.match(tasks, /resolveCloudQueryTarget\(undefined, c\.req\.query\('model'\), user\.id\)/)
  assert.match(tasks, /maskApiKey\(cfg\.apiKey\)/)
  // 本人归属：自有项目 / 无项目历史任务（未落 user_id）/ 本人提交；
  // 无项目但落了他人 user_id 的任务不再放行（下推 SQL，见 ownerCond）
  assert.match(tasks, /ownedDramaIds\(user\)/)
  assert.match(tasks, /\$\{schema\.sysTask\.userId\} IS NULL OR \$\{schema\.sysTask\.userId\} = \$\{user\.id\}/)
  assert.match(tasks, /\.limit\(500\)/)
  // 用户侧仍不返回云端陌生任务明细，只回总量
  assert.doesNotMatch(tasks, /cloud_only: cmp\.cloudOnly/)
  assert.match(tasks, /cloud_only_total: cmp\.cloudOnly\.length/)
})

test('cloud-tasks service: central domain query + shared resolve/compare helpers', () => {
  const svc = readCloudTasksSources(backendRoot)

  // 列表接口仅中央域名可用（workspace 域名 404），必须写死中央域名
  assert.match(svc, /https:\/\/dashscope\.aliyuncs\.com\/api\/v1\/tasks/)
  // 分页拉取 + 上限截断，避免积压过大打满 20 QPS
  assert.match(svc, /page_no=/)
  assert.match(svc, /CLOUD_TASK_FETCH_CAP/)
  assert.match(svc, /truncated: total > items\.length/)
  // 同时查 PENDING + RUNNING 并以 task_id 建索引
  assert.match(svc, /'PENDING'/)
  assert.match(svc, /'RUNNING'/)
  assert.match(svc, /byTaskId\.set/)

  // 共享解析：支持按用户限定配置属主（WHERE 下推）；配置 model 为 JSON 数组时解析取首项，
  // 否则近 7 天任务动态推导，最后回退默认模型；Key 掩码供两端展示
  assert.match(svc, /resolveCloudQueryTarget/)
  assert.match(svc, /userId\?: number/)
  assert.match(svc, /eq\(schema\.aiServiceConfigs\.userId, userId\)/)
  assert.match(svc, /maskApiKey/)
  assert.match(svc, /JSON\.parse\(raw\)/)
  assert.match(svc, /recent\[0\]\?\.model \|\| 'wan3\.0-video'/)
  // 共享比对：三类结果
  assert.match(svc, /compareLocalWithCloud/)
  assert.match(svc, /cloudOnly/)
  assert.match(svc, /localOnly/)
})
