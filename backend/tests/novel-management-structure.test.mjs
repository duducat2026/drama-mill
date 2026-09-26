import { readMigrationsSources } from './helpers/migrations-sources.mjs'
import { readAdminSources } from './helpers/admin-sources.mjs'
import { readProductionBatchSources } from './helpers/production-batch-sources.mjs'
import { readNovelRouteSources } from './helpers/novel-route-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSchemaSources } from './helpers/schema-sources.mjs'
import { readMysqlSchemaSources } from './helpers/mysql-schema-sources.mjs'

const root = new URL('..', import.meta.url)
const repoRoot = new URL('../../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const readRepo = (path) => readFileSync(new URL(path, repoRoot), 'utf8')

test('novels table supports library mode and split template template columns', () => {
  const schema = readSchemaSources(root)
  // drama_id 放开可空（小说库模式：先入库后建项目）
  assert.match(schema, /dramaId: int\('drama_id'\),/)
  assert.doesNotMatch(schema, /novels = mysqlTable[\s\S]{0,400}drama_id'\)\.notNull\(\)/)
  assert.match(schema, /splitTemplateId: int\('split_template_id'\)/)
  assert.match(schema, /userId: int\('user_id'\)/)
  assert.match(schema, /deletedAt: varchar\('deleted_at'/)
  // 批次快照拆分提示词（模版后续修改/删除不影响在途批次）
  assert.match(schema, /splitPrompt: text\('split_prompt'\)/)
})

test('novel_split_templates table + system seeds (novel/poetry/humor) defined', () => {
  const schema = readSchemaSources(root)
  assert.match(schema, /novelSplitTemplates = mysqlTable\('novel_split_templates'/)

  const ddl = readMysqlSchemaSources(root)
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS novel_split_templates/)
  assert.match(ddl, /UNIQUE KEY uk_novel_split_templates_value_user \(value, user_id\)/)
  // 系统模版种子：小说 / 诗词 / 幽默笑话（user_id NULL = 系统内置）
  assert.match(ddl, /novelSplitTemplateSeeds = \[/)
  assert.match(ddl, /name: '小说', value: 'novel'/)
  assert.match(ddl, /name: '诗词', value: 'poetry'/)
  assert.match(ddl, /name: '幽默笑话', value: 'humor'/)
  assert.match(ddl, /novel_split_templates[\s\S]{0,300}user_id` IS NULL/)

  const initSql = readRepo('docker/init.sql')
  assert.match(initSql, /CREATE TABLE IF NOT EXISTS novel_split_templates/)
  assert.match(initSql, /SELECT '小说', 'novel'/)
  assert.match(initSql, /SELECT '诗词', 'poetry'/)
  assert.match(initSql, /SELECT '幽默笑话', 'humor'/)
})

test('migrations add novel library columns idempotently and backfill ownership', () => {
  const mig = readMigrationsSources(root)
  assert.match(mig, /async function ensureColumnNullable/)
  assert.match(mig, /ensureColumn\(pool, 'novels', 'user_id'/)
  assert.match(mig, /ensureColumn\(pool, 'novels', 'deleted_at'/)
  assert.match(mig, /ensureColumn\(pool, 'novels', 'split_template_id'/)
  // ensureColumnNullable 的 ddl 仅传列类型（列名由函数拼接，重复传列名会造成 SQL 语法错误）
  assert.match(mig, /ensureColumnNullable\(pool, 'novels', 'drama_id', 'INT'\)/)
  assert.match(mig, /ensureIndex\(pool, 'novels', 'idx_novels_user_id', 'user_id'\)/)
  assert.match(mig, /ensureColumn\(pool, 'production_batches', 'split_prompt'/)
  assert.match(mig, /async function backfillNovelOwnership/)
})

test('split templates route mounted with tenant-scoped CRUD', () => {
  const entry = read('src/index.ts')
  assert.match(entry, /api\.route\('\/novel-split-templates', novelSplitTemplates\)/)

  const route = read('src/routes/novel-split-templates.ts')
  assert.match(route, /app\.get\('\/'/)
  assert.match(route, /app\.post\('\/'/)
  assert.match(route, /app\.put\('\/:id'/)
  assert.match(route, /app\.delete\('\/:id'/)
  // user_id NULL = 系统内置；系统行仅 admin 可改
  assert.match(route, /is_system: r\.userId === null/)
  assert.match(route, /if \(row\.userId === null\) return user\.role === 'admin'/)
  assert.match(route, /export async function getTemplateUsable/)
  assert.match(route, /VALUE_PATTERN/)
})

test('novels route supports library list / preview / edit / delete / batch delete / create projects', () => {
  const route = readNovelRouteSources(root)
  // 上传可不带 drama_id 直入小说库
  assert.match(route, /const dramaId = Number\(body\['drama_id'\]\) \|\| null/)
  // 列表投影不含正文（MEDIUMTEXT 列禁止携带）
  assert.match(route, /NOVEL_SLIM_COLUMNS/)
  assert.doesNotMatch(route, /NOVEL_SLIM_COLUMNS = \{[\s\S]{0,600}content: schema\.novels\.content/)
  // 小说库列表真实分页：过滤下推 SQL（COUNT + LIMIT/OFFSET），禁止内存 filter/sort 全量加载；
  // keyword 下推 like；返回 { items, pagination } 契约（drama_id 模式仍返回数组）
  assert.match(route, /page_size/)
  assert.match(route, /like\(schema\.novels\.title/)
  assert.match(route, /COUNT\(\*\)/)
  assert.match(route, /\.limit\(pageSize\)\.offset\(\(page - 1\) \* pageSize\)/)
  assert.match(route, /pagination: \{ page, page_size: pageSize, total: Number\(total\)/)
  assert.match(route, /app\.get\('\/:id\/content'/)
  assert.match(route, /app\.get\('\/:id\/dramas'/)
  assert.match(route, /app\.put\('\/:id'/)
  assert.match(route, /app\.delete\('\/:id'/)
  assert.match(route, /app\.post\('\/batch-delete'/)
  assert.match(route, /app\.post\('\/create-projects'/)
  // 软删除而非物理删除（已生成项目不受影响）
  assert.match(route, /set\(\{ deletedAt: now\(\)/)
  // 正文变更重置拆分状态
  assert.match(route, /updates\.splitStatus = 'uploaded'/)
  // 批量建项目支持拆分模版快照 + 两步走模式 + 自动启动
  assert.match(route, /getTemplateUsable\(Number\(body\.split_template_id\), user\)/)
  assert.match(route, /createBatch\(user\.id, items, targetChars, splitPrompt, \{ mode: batchMode, splitMode, paragraphsPerEpisode \}\)/)
  assert.match(route, /body\.mode === 'split_only' \? 'split_only' : 'full'/)
  // 两步走模式下建批即启动拆分（第一步），生产经批次面板 /:id/produce 启动（第二步）
  assert.match(route, /batchMode === 'split_only'\) started = startBatch/)
  assert.match(route, /单次最多选择 100 部小说/)
  // 拆分入口支持模版
  assert.match(route, /app\.post\('\/:id\/split'/)
  assert.match(route, /template_id/)
})

test('novel split service injects template prompt and guards missing drama', () => {
  const svc = read('src/services/novel-split.ts')
  assert.match(svc, /splitPrompt\?: string/)
  assert.match(svc, /拆分模版要求（必须遵守）/)
  // 小说库模式下无项目不允许拆分
  assert.match(svc, /小说尚未创建项目，请先创建项目后再拆分/)
  assert.match(svc, /split_template_id: opts\.splitTemplateId/)
})

test('production batch carries split prompt snapshot end to end', () => {
  const svc = readProductionBatchSources(root)
  assert.match(svc, /splitPrompt\?: string \| null/)
  assert.match(svc, /splitPrompt: splitPrompt \|\| null/)
  assert.match(svc, /has_split_prompt: !!batch\.splitPrompt/)

  const route = read('src/routes/production-batch.ts')
  assert.match(route, /split_template_id/)
  assert.match(route, /getTemplateUsable/)
})

test('split template route accepts split_mode / default_paragraphs (paragraphs mode for poetry & humor)', () => {
  const route = read('src/routes/novel-split-templates.ts')
  // 拆分方式白名单：paragraphs 按段落数归组，其余按字数归组
  assert.match(route, /function normalizeSplitMode/)
  assert.match(route, /return v === 'paragraphs' \? 'paragraphs' : 'chars'/)
  assert.match(route, /splitMode,/)
  assert.match(route, /defaultParagraphs: splitMode === 'paragraphs'/)
  assert.match(route, /updates\.splitMode = normalizeSplitMode\(body\.split_mode\)/)
})

test('template tables carry split_mode/default_paragraphs and poetry/humor seeds are paragraph mode', () => {
  const schema = readSchemaSources(root)
  assert.match(schema, /splitMode: varchar\('split_mode', \{ length: 16 \}\)\.notNull\(\)\.default\('chars'\)/)
  assert.match(schema, /defaultParagraphs: int\('default_paragraphs'\)/)
  // 批次快照拆分方式（模版后续修改不影响在途批次）
  assert.match(schema, /mode: varchar\('mode', \{ length: 16 \}\)\.notNull\(\)\.default\('full'\)/)
  assert.match(schema, /paragraphsPerEpisode: int\('paragraphs_per_episode'\)/)

  const ddl = readMysqlSchemaSources(root)
  assert.match(ddl, /split_mode VARCHAR\(16\) NOT NULL DEFAULT 'chars'/)
  assert.match(ddl, /default_paragraphs INT/)
  // 系统种子：诗词每集 20 段 / 幽默笑话每集 15 段（按段落数拆分）
  assert.match(ddl, /value: 'poetry'[\s\S]{0,120}splitMode: 'paragraphs', defaultParagraphs: 20/)
  assert.match(ddl, /value: 'humor'[\s\S]{0,120}splitMode: 'paragraphs', defaultParagraphs: 15/)

  // 1.58 迁移：补列幂等 + 存量系统诗词/幽默模版升级段落模式（仅命中未迁移行）
  const mig = readMigrationsSources(root)
  assert.match(mig, /ensureColumn\(pool, 'novel_split_templates', 'split_mode'/)
  assert.match(mig, /ensureColumn\(pool, 'novel_split_templates', 'default_paragraphs'/)
  assert.match(mig, /ensureColumn\(pool, 'production_batches', 'mode'/)
  assert.match(mig, /ensureColumn\(pool, 'production_batches', 'paragraphs_per_episode'/)
  assert.match(mig, /UPDATE novel_split_templates SET split_mode = 'paragraphs'[\s\S]{0,200}WHEN 'poetry' THEN 20 WHEN 'humor' THEN 15/)

  const initSql = readRepo('docker/init.sql')
  assert.match(initSql, /split_mode/)
  assert.match(initSql, /default_paragraphs/)
})

test('split service supports paragraphs mode grouping by paragraph count', () => {
  const svc = read('src/services/novel-split.ts')
  assert.match(svc, /splitMode\?: 'chars' \| 'paragraphs'/)
  assert.match(svc, /paragraphsPerEpisode\?: number/)
  assert.match(svc, /groupParagraphs/)
  // 拆分快照记录拆分方式与每集段落数（第 X–Y 段）
  assert.match(svc, /paragraphs_per_episode/)

  const text = read('src/services/novel-text.ts')
  assert.match(text, /export function detectParagraphs/)
  assert.match(text, /export function groupParagraphs/)
  assert.match(text, /DEFAULT_PARAGRAPHS_PER_EPISODE = 20/)
})

test('production batch supports two-step split_only mode with produce endpoint', () => {
  const svc = readProductionBatchSources(root)
  // 两步走：mode full/split_only；split_done 为拆分完成待生产中间态；
  // split_only 模式下 split_done 不再调度，等 /:id/produce 改回 full 后续接生产
  assert.match(svc, /export type BatchMode = 'full' \| 'split_only'/)
  assert.match(svc, /'split_done'/)
  assert.match(svc, /SPLIT_ONLY_RETRYABLE_STATUSES/)
  assert.match(svc, /export async function produceBatch/)
  assert.match(svc, /mode: 'full', updatedAt: now\(\)/)
  // 详情/列表输出含 mode 与 split_done 计数（前端启动生产按钮依赖）
  assert.match(svc, /split_done: 0/)

  const route = read('src/routes/production-batch.ts')
  assert.match(route, /app\.post\('\/:id\/produce'/)
  assert.match(route, /String\(body\['mode'\] \|\| ''\) === 'split_only' \? 'split_only' : 'full'/)
  // split_only 建批恒启动拆分（第一步）
  assert.match(route, /batchMode === 'split_only' \|\| String\(body\['auto_start'\]/)

  // 管理端模版 CRUD 同步支持拆分方式字段
  const admin = readAdminSources(new URL('..', import.meta.url))
  assert.match(admin, /updates\.splitMode = body\.split_mode === 'paragraphs' \? 'paragraphs' : 'chars'/)
  assert.match(admin, /defaultParagraphs: splitMode === 'paragraphs'/)
})

test('admin routes expose novel search / preview / delete and template management', () => {
  const admin = readAdminSources(new URL('..', import.meta.url))
  // 检索：用户名/小说名/创建日期范围全部下推 SQL
  assert.match(admin, /app\.get\('\/novels'/)
  assert.match(admin, /query\('username'\)/)
  assert.match(admin, /query\('from'\)/)
  assert.match(admin, /query\('to'\)/)
  assert.match(admin, /COUNT\(\*\)/)
  assert.match(admin, /\.limit\(pageSize\)\.offset/)
  // 列表投影不含正文
  assert.match(admin, /ADMIN_NOVEL_SLIM/)
  assert.doesNotMatch(admin, /ADMIN_NOVEL_SLIM = \{[\s\S]{0,600}content: schema\.novels\.content/)
  // 预览 / 删除 / 生成项目
  assert.match(admin, /app\.get\('\/novels\/:id\/content'/)
  assert.match(admin, /app\.delete\('\/novels\/:id'/)
  assert.match(admin, /app\.get\('\/novels\/:id\/dramas'/)
  assert.match(admin, /episode_count/)
  // 模版管理：默认创建系统内置
  assert.match(admin, /app\.get\('\/novel-split-templates'/)
  assert.match(admin, /app\.post\('\/novel-split-templates'/)
  assert.match(admin, /app\.put\('\/novel-split-templates\/:id'/)
  assert.match(admin, /app\.delete\('\/novel-split-templates\/:id'/)
  assert.match(admin, /system_only/)
})
