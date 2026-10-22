import { readAdminSources } from './helpers/admin-sources.mjs'
import { readModelCatalogSources } from './helpers/model-catalog-sources.mjs'
import { readSchemaSources } from './helpers/schema-sources.mjs'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('模型目录价服务：主库目录表检索 + 批量删除即退出计价，运行时零外部 model_list 依赖', () => {
  const svc = readModelCatalogSources(root)
  // 外部连接池与 MODEL_LIST_* 覆盖已彻底移除
  assert.doesNotMatch(svc, /mysql\.createPool|MODEL_LIST_HOST|catalogUrl|inContainer/)
  // 检索走主库 drizzle 目录表；模型清单/单模型明细能力已下线
  assert.match(svc, /schema\.modelCatalogModels/)
  assert.match(svc, /schema\.modelCatalogPrices/)
  assert.doesNotMatch(svc, /export async function listCatalogModels|export async function pricesOfModel/)
  assert.match(svc, /export async function listCatalogPrices/)
  assert.match(svc, /export async function catalogStats/)
  // 批量删除：目录价即刊例价，仅删目录行本身，不再联动清理任何副本表
  assert.match(svc, /export async function batchDeleteCatalogPrices/)
  assert.match(svc, /db\.delete\(P\)\.where\(inArray\(P\.id, ids\)\)/)
  assert.doesNotMatch(svc, /db\.delete\(schema\.modelPrices\)/, '批量删除不应再联动删 model_prices')
  // COUNT + limit/offset 分页语义保持；响应经 toSnakeCase 维持原列名契约
  assert.match(svc, /COUNT\(\*\)/)
  // 分组聚合计数须显式 AS 别名，否则 ORDER BY c 在 MySQL 报未知列
  assert.match(svc, /COUNT\(\*\) AS c/)
  assert.match(svc, /\.limit\(f\.pageSize\)\.offset\(\(f\.page - 1\) \* f\.pageSize\)/)
  assert.match(svc, /\.map\(toSnakeCase\)/)
  // 目录表未初始化（0 行）沿用 CatalogUnavailable → 接口层 503，提示迁移脚本
  assert.match(svc, /export class CatalogUnavailable extends Error/)
  assert.match(svc, /async function guardInitialized/)
  assert.match(svc, /migrate-model-catalog/)
})

test('目录表收编 schema/DDL/init.sql，迁移脚本按 id upsert 幂等且不放大字段', () => {
  const schema = readSchemaSources(root)
  assert.match(schema, /mysqlTable\('model_catalog_models'/)
  assert.match(schema, /mysqlTable\('model_catalog_prices'/)
  assert.match(schema, /index\('idx_mcm_model_id'\)/)
  assert.match(schema, /index\('idx_mcp_model_id'\)/)

  const ddl = read('src/db/mysql-schema-platform.ts')
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS model_catalog_models/)
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS model_catalog_prices/)

  const init = read('../docker/init.sql')
  assert.match(init, /CREATE TABLE IF NOT EXISTS model_catalog_models/)

  const mig = read('scripts/migrate-model-catalog.ts')
  assert.match(mig, /ON DUPLICATE KEY UPDATE/)
  assert.match(mig, /--source-database=/)
  // 大字段不带入主库（列清单字符串中不得出现；注释提及不算）
  assert.doesNotMatch(mig, /'raw_json'|'price_raw'|'inference_metadata_raw'/)
})

test('目录数据快照随仓库发布：data.sql 自含 DDL + 幂等 upsert，compose 首启自动加载', () => {
  const data = read('../docker/model-catalog-data.sql')
  // 自含建表：可先于应用启动导入
  assert.match(data, /CREATE TABLE IF NOT EXISTS model_catalog_models/)
  assert.match(data, /CREATE TABLE IF NOT EXISTS model_catalog_prices/)
  // 两表数据均按主键 id upsert，幂等可重跑
  assert.match(data, /INSERT INTO `model_catalog_models`/)
  assert.match(data, /INSERT INTO `model_catalog_prices`/)
  assert.match(data, /ON DUPLICATE KEY UPDATE/)

  const exp = read('scripts/export-catalog-sql.ts')
  assert.match(exp, /model-catalog-data\.sql/)
  assert.match(exp, /ON DUPLICATE KEY UPDATE/)

  const compose = read('../docker-compose.yml')
  assert.match(compose, /init\.sql:\/docker-entrypoint-initdb\.d\/01-init\.sql/)
  assert.match(compose, /model-catalog-data\.sql:\/docker-entrypoint-initdb\.d\/02-model-catalog-data\.sql/)

  // 503 引导文案指向快照导入（GitHub 下载者无外部采集库可迁）
  const svc = readModelCatalogSources(root)
  assert.match(svc, /docker\/model-catalog-data\.sql/)
})

test('模型目录价接口：admin 守卫下的概览/价格分页 + 批量删除（导入端点已下线）', () => {
  const admin = readAdminSources(new URL('..', import.meta.url))
  assert.match(admin, /from '\.\.\/\.\.\/services\/model-catalog\.js'/)
  assert.match(admin, /app\.get\('\/model-catalog\/stats'/)
  assert.match(admin, /app\.get\('\/model-catalog\/prices'/)
  assert.doesNotMatch(admin, /model-catalog\/models|model-catalog\/prices-of/, '模型清单/明细端点应已下线')
  // 批量删除：ids 校验 + 上限 1000
  assert.match(admin, /app\.post\('\/model-catalog\/batch-delete'/)
  assert.match(admin, /badRequest\(c, 'ids 必须为正整数数组'\)/)
  assert.match(admin, /ids\.length > 1000/)
  // 目录价即刊例价：不再有"导入到刊例价表"的落库动作
  assert.doesNotMatch(admin, /model-catalog\/import|importCatalogPrices/, '导入端点应已下线')
  // 目录未初始化转 503 提示（其它异常透传全局 errorHandler）
  assert.match(admin, /err instanceof CatalogUnavailable/)
  assert.match(admin, /code: 503, message: err\.message \}, 503/)
})

test('平台刊例价 admin 端点全量下线：目录价即刊例价，不再有单独维护接口', () => {
  const admin = readAdminSources(new URL('..', import.meta.url))
  assert.doesNotMatch(admin, /model-prices/, 'admin 侧不应再有任何 model-prices 端点')
  assert.ok(!existsSync(new URL('src/routes/admin/model-prices.ts', import.meta.url)), 'admin/model-prices.ts 应已删除')
})

test('目录价派生刊例计价：主库目录表聚合 + 计费类型映射 + USD 折算，不再写入 model_prices', () => {
  const svc = readModelCatalogSources(root)
  // 取数来自主库目录表（drizzle），不再有任何裸 SQL 外部查询
  assert.doesNotMatch(svc, /FROM prices WHERE/)
  assert.match(svc, /const P = schema\.modelCatalogPrices/)
  // 仅取在售价格行聚合（0 或 NULL 视为在售，与原 SQL 语义一致）
  assert.match(svc, /or\(eq\(P\.isOffline, false\), isNull\(P\.isOffline\)\)/)
  // 派生入口：聚合全量可计费模型计划；同名重复首条为准
  assert.match(svc, /export async function deriveCatalogPlans/)
  assert.match(svc, /if \(seen\.has\(plan\.model\)\) continue/)
  // 目录价即刊例价：服务不再 INSERT 平台 model_prices，也不依赖查价缓存失效（实时派生 + 自身 TTL）
  assert.doesNotMatch(svc, /db\.insert\(schema\.modelPrices\)/, '不应再落库 model_prices')
  assert.doesNotMatch(svc, /invalidatePriceCache/, '派生服务不直接接触查价缓存')
  // 计费类型优先级：视频(每秒) > 图片(每张) > token(输入/输出)
  assert.match(svc, /function buildPlan/)
  assert.match(svc, /billing_type: 'video_second'/)
  assert.match(svc, /billing_type: 'image'/)
  assert.match(svc, /billing_type: 'token'/)
  // token 输入/输出排除缓存/思考/Batch 变体（含英文档名 cached/thinking/reasoning）
  assert.match(svc, /const exclude = \/缓存\|思考\|cached\|thinking\|reasoning\|batch\/i/)
  // token 档名兼容中英文：中文前缀 + 英文 input|prompt / output|completion 词匹配
  assert.match(svc, /\\b\(input\|prompt\)\\b/)
  assert.match(svc, /\\b\(output\|completion\)\\b/)
  // 裸输入档缺失时回退取「缓存未命中 / cache miss」档（deepseek/kimi 仅有分档）
  assert.match(svc, /未命中\|cache miss/)
  // 多档取最低价
  assert.match(svc, /Math\.min\(\.\.\./)
  // USD 折算：汇率默认 7.2，可由 CATALOG_USD_CNY_RATE 覆盖
  assert.match(svc, /process\.env\.CATALOG_USD_CNY_RATE/)
  assert.match(svc, /n > 0 \? n : 7\.2/)
  assert.match(svc, /isUsd\(r\) \? usdRate : 1/)
})
