import { readMigrationsSources } from './helpers/migrations-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readMysqlSchemaSources } from './helpers/mysql-schema-sources.mjs'
import { readAgentsIndexSources } from './helpers/agents-index-sources.mjs'
import { readDramasRouteSources } from './helpers/dramas-route-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('drama creation no longer pre-creates episodes from total_episodes', () => {
  const dramas = readDramasRouteSources(root)

  assert.doesNotMatch(dramas, /total_episodes \|\| 1/)
  assert.doesNotMatch(dramas, /第\$\{i\}集/)
  assert.doesNotMatch(dramas, /Create default episodes/)
})

test('drama creation records a fixed aspect ratio for video generation', () => {
  const dramas = readDramasRouteSources(root)

  assert.match(dramas, /aspectRatio: body\.aspect_ratio \|\| '16:9'/)
  assert.match(dramas, /if \(body\.aspect_ratio !== undefined\) updates\.aspectRatio = body\.aspect_ratio/)
})

test('style presets route is mounted and implements CRUD', () => {
  const entry = read('src/index.ts')
  const route = read('src/routes/stylePresets.ts')

  assert.match(entry, /api\.route\('\/style-presets', stylePresets\)/)
  assert.match(route, /app\.get\('\/'/)
  assert.match(route, /app\.post\('\/'/)
  assert.match(route, /app\.put\('\/:id'/)
  assert.match(route, /app\.delete\('\/:id'/)
  // value 唯一约束 + 格式校验 + 查重
  assert.match(route, /VALUE_PATTERN/)
  assert.match(route, /风格 key 已存在/)
  // GET 支持 ?all=1 且默认过滤停用项
  assert.match(route, /query\('all'\)/)
  assert.match(route, /r\.isActive/)
})

test('style presets are tenant-scoped with protected system rows', () => {
  const route = read('src/routes/stylePresets.ts')
  const service = read('src/services/style-preset.ts')
  const migrations = readMigrationsSources(root)
  const mysqlSchema = readMysqlSchemaSources(root)

  // 列与索引：user_id NULL = 系统内置；全局唯一索引放宽为 (value, user_id)
  assert.match(mysqlSchema, /uk_style_presets_value_user \(value, user_id\)/)
  assert.match(migrations, /ensureColumn\(pool, 'style_presets', 'user_id'/)
  assert.match(migrations, /dropIndex\(pool, 'style_presets', 'uk_style_presets_value'\)/)
  assert.match(migrations, /ensureUniqueIndex\(pool, 'style_presets', 'uk_style_presets_value_user', 'value, user_id'\)/)
  // 种子只补系统内置行，不被用户同名私有风格阻断
  assert.match(mysqlSchema, /WHERE `value` = \? AND `user_id` IS NULL/)

  // 路由：列表只返回系统内置 + 自己的私有；系统内置行仅 admin 可改，私有行仅属主
  assert.match(route, /or\(isNull\(schema\.stylePresets\.userId\), eq\(schema\.stylePresets\.userId, user\.id\)\)/)
  assert.match(route, /function canModify/)
  assert.match(route, /userId: isSystem \? null : user\.id/)
  assert.match(route, /is_system: r\.userId === null/)

  // 消费端：预设全表走 60s TTL 缓存（生图提示词高频路径），按项目属主匹配，私有风格优先于同名内置（NULL）
  assert.match(service, /createTtlListCache/)
  assert.match(service, /p\.value === drama\.style && \(p\.userId === null \|\| p\.userId === drama\.userId\)/)
  assert.match(service, /visible\.find\(p => p\.userId !== null\) \|\| visible\.find\(p => p\.userId === null\)/)
  // 写侧三端点（POST/PUT/DELETE）均显式失效，改完立刻可见新值
  assert.equal((route.match(/invalidateStylePresetCache\(\)/g) || []).length, 3)
})

test('drama style prompt is injected into image prompt composition', () => {
  const service = read('src/services/style-preset.ts')
  const gridTools = read('src/agents/tools/image-prompt-tools.ts')
  // 生图循环已抽到 asset-images 服务（路由与生产编排器共用），风格注入随之迁移
  const assetImages = read('src/services/asset-images.ts')

  assert.match(service, /getDramaStylePrompt/)
  assert.match(service, /p\.value === drama\.style/)
  assert.match(gridTools, /getDramaStylePrompt\(dramaId\)/)
  // 保存最终提示词时由工具拼接项目视觉风格（风格片段置于最前方）
  assert.match(gridTools, /stylePrompt \? `\$\{stylePrompt\}, \$\{prompt\}` : prompt/)
  assert.match(assetImages, /getDramaStylePrompt\(char\.dramaId\)/)
  assert.match(assetImages, /getDramaStylePrompt\(scene\.dramaId\)/)
  assert.match(assetImages, /characterImagePrompt\(char, stylePrompt\)/)
})

test('agent default prompts no longer hardcode consistent art style', () => {
  const agents = readAgentsIndexSources(root)

  assert.doesNotMatch(agents, /必须包含 "consistent art style"/)
  assert.match(agents, /视觉风格描述会由工具/)
})
