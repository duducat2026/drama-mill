import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSchemaSources } from './helpers/schema-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('user_model_prices schema: drizzle 定义 + 幂等 DDL + init.sql 均落唯一键 user_id+model', () => {
  const schema = readSchemaSources(root)
  assert.match(schema, /export const userModelPrices = mysqlTable\('user_model_prices'/)
  assert.match(schema, /uniqueIndex\('uniq_ump_user_model'\)\.on\(t\.userId, t\.model\)/)
  assert.match(schema, /index\('idx_ump_user_id'\)\.on\(t\.userId\)/)
  assert.match(schema, /source: varchar\('source', \{ length: 32 \}\)\.default\('manual'\)/)

  const ddl = read('src/db/mysql-schema-platform.ts')
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS user_model_prices/)
  assert.match(ddl, /UNIQUE KEY uniq_ump_user_model \(user_id, model\)/)

  const init = read('../docker/init.sql')
  assert.match(init, /CREATE TABLE IF NOT EXISTS user_model_prices/)
})

test('cost-price-lookup: 用户价 → 目录价(即刊例价) → 历史 model_prices 兜底，60s 缓存 + 写后失效', () => {
  const svc = read('src/services/cost-price-lookup.ts')
  // 用户价按 user_id+model 命中优先
  assert.match(svc, /export async function lookupPrice\(\s*provider[\s\S]*userId\?: number \| null/)
  assert.match(svc, /if \(userId\) \{[\s\S]*getUserMap\(userId\)\)\.get\(model\)[\s\S]*if \(userRow\) return userRow/)
  // 第二级：目录价实时派生（model_catalog_* 聚合），provider|model 精确 → model 名回退
  assert.match(svc, /import \{ deriveCatalogPlans \} from '\.\/model-catalog-price\.js'/)
  assert.match(svc, /const cat = await getCatalogMaps\(\)/)
  assert.match(svc, /provider \? cat\.exact\.get\(`\$\{provider\}\|\$\{model\}`\) : undefined\) \?\? cat\.byModel\.get\(model\)/)
  // 第三级：历史 model_prices 兜底（命中目录价则不查）
  assert.match(svc, /if \(catalogRow\) return catalogRow/)
  assert.match(svc, /provider \? exact\.get\(`\$\{provider\}\|\$\{model\}`\) : undefined\) \?\? byModel\.get\(model\)/)
  // 剥离前缀回退：原名各级均未命中且含 "/" 时，用裸模型名重查整条链（最后手段，不先试裸名）
  assert.match(svc, /const row = await lookupByModel\(provider, model, userId\)/)
  assert.match(svc, /const bare = stripVendorPrefix\(model\)/)
  assert.match(svc, /return bare \? lookupByModel\(provider, bare, userId\) : undefined/)
  assert.match(svc, /idx > 0 && idx < model\.length - 1 \? model\.slice\(idx \+ 1\)/)
  // 各级缓存均 60s TTL；用户缓存按 userId 分桶；目录派生独立缓存
  assert.match(svc, /const TTL_MS = 60_000/)
  assert.match(svc, /const userCache = new Map<number, \{ at: number; byModel: Map<string, PriceRow> \}>\(\)/)
  assert.match(svc, /let catalogExact: Map<string, PriceRow> \| null = null/)
  // 失效函数：无参清平台价（含目录派生）、带 userId 清单用户
  assert.match(svc, /export function invalidatePriceCache\(userId\?: number\)/)
  assert.match(svc, /catalogExact = null; catalogByModel = null; catalogCacheAt = 0/)
  assert.match(svc, /userCache\.delete\(userId\)/)
})

test('cost.ts 记录链路：三处计价全部传 ctx.userId，旧缓存已抽离不残留', () => {
  const cost = read('src/services/cost.ts')
  assert.match(cost, /import \{ lookupPrice, type PriceRow \} from '\.\/cost-price-lookup\.js'/)
  const calls = cost.match(/lookupPrice\(provider, model, ctx\.userId\)/g) || []
  assert.equal(calls.length, 3, '文本/图片/视频三处查价都应传 userId')
  // 价格缓存逻辑已迁出，cost.ts 不再直接接触 modelPrices / 本地缓存
  assert.doesNotMatch(cost, /schema\.modelPrices/)
  assert.doesNotMatch(cost, /priceCache/)
})

test('routes/index: /model-prices 六端点注册在用户鉴权之后、admin 之前', () => {
  const route = read('src/routes/user-model-prices.ts')
  assert.match(route, /app\.get\('\/', async/)
  assert.match(route, /app\.get\('\/catalog', async/)
  assert.match(route, /app\.post\('\/import', async/)
  assert.match(route, /app\.post\('\/', async/)
  assert.match(route, /app\.put\('\/:id', async/)
  assert.match(route, /app\.delete\('\/:id', async/)
  // 鉴权取 c.get('user')，所有读写限定本人 user_id
  assert.match(route, /const user = c\.get\('user'\)/)
  assert.match(route, /eq\(schema\.userModelPrices\.userId, user\.id\)/)
  // 平台基准 = 目录价（model_catalog_* 实时派生），不再读独立维护的 model_prices
  assert.match(route, /import \{ deriveCatalogPlans \} from '\.\.\/services\/model-catalog\.js'/)
  assert.match(route, /let plans = await deriveCatalogPlans\(\)/)
  assert.doesNotMatch(route, /schema\.modelPrices/, '用户价路由不应再依赖单独维护的刊例价表')
  // 导入拷贝目录价 source='platform' 且已存在跳过；手工/改价 source='manual'
  assert.match(route, /source: 'platform'/)
  assert.match(route, /source: 'manual'/)
  assert.match(route, /mineSet\.has\(model\)/, '导入应跳过已有行不覆盖')
  // 目录分页上限 100、单次导入上限 200
  assert.match(route, /Math\.min\(100, Math\.max\(1, Number\(c\.req\.query\('page_size'\)\)/)
  assert.match(route, /items\.length > 200/)
  // 写操作后即时失效用户价缓存
  const invalidates = route.match(/invalidatePriceCache\(user\.id\)/g) || []
  assert.ok(invalidates.length >= 4, 'import/create/update/delete 四处都应失效缓存')

  const idx = read('src/index.ts')
  assert.match(idx, /import userModelPrices from '\.\/routes\/user-model-prices\.js'/)
  assert.match(idx, /api\.route\('\/model-prices', userModelPrices\)/)
  // 挂在业务 API 子应用：先鉴权再路由
  const auth = idx.slice(idx.indexOf('const api = new Hono()'), idx.indexOf("api.route('/model-prices'"))
  assert.match(auth, /api\.use\('\*', authMiddleware\)/)
})
