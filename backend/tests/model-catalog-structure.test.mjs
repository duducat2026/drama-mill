import { readAdminSources } from './helpers/admin-sources.mjs'
import { readModelCatalogSources } from './helpers/model-catalog-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('模型目录价服务：独立 model_list 库连接 + 模型清单/价格列表只读提取', () => {
  const svc = readModelCatalogSources(root)
  // 凭据默认复用主库 MYSQL_*（同实例同业务账号），库名默认 model_list，支持 MODEL_LIST_* 单独覆盖
  assert.match(svc, /process\.env\.MODEL_LIST_DATABASE \|\| 'model_list'/)
  assert.match(svc, /process\.env\.MODEL_LIST_USER \|\| process\.env\.MYSQL_USER/)
  assert.match(svc, /process\.env\.MODEL_LIST_PASSWORD \|\| process\.env\.MYSQL_PASSWORD/)
  // 懒建连接池：目录库不可达不影响主服务启动
  assert.match(svc, /let poolPromise: Promise<mysql\.Pool> \| null = null/)
  assert.match(svc, /function getPool\(\)/)
  // 模型清单/价格列表均走 COUNT + LIMIT/OFFSET 分页，且过滤参数全部占位符化（防注入）
  assert.match(svc, /export async function listCatalogModels/)
  assert.match(svc, /export async function listCatalogPrices/)
  assert.match(svc, /SELECT COUNT\(\*\) AS c FROM models/)
  assert.match(svc, /SELECT COUNT\(\*\) AS c FROM prices/)
  assert.match(svc, /LIMIT \? OFFSET \?/)
  // 列表投影剔除 raw_json / price_raw 等大字段
  assert.match(svc, /const MODEL_COLUMNS = `id, name, model_id, provider/)
  assert.ok(!/raw_json/.test(svc.match(/const MODEL_COLUMNS = `[\s\S]*?`/)[0]))
  assert.ok(!/price_raw/.test(svc.match(/const PRICE_COLUMNS = `[\s\S]*?`/)[0]))
  // 不可达错误统一封装为 CatalogUnavailable，供接口层转 503
  assert.match(svc, /export class CatalogUnavailable extends Error/)
  assert.match(svc, /ECONNREFUSED\|ENOTFOUND\|ER_ACCESS_DENIED/)
})

test('模型目录价接口：admin 守卫下的四个只读端点', () => {
  const admin = readAdminSources(new URL('..', import.meta.url))
  assert.match(admin, /from '\.\.\/\.\.\/services\/model-catalog\.js'/)
  assert.match(admin, /app\.get\('\/model-catalog\/stats'/)
  assert.match(admin, /app\.get\('\/model-catalog\/models'/)
  assert.match(admin, /app\.get\('\/model-catalog\/prices'/)
  assert.match(admin, /app\.get\('\/model-catalog\/prices-of'/)
  // 目录库不可达转 503 提示（其它异常透传全局 errorHandler）
  assert.match(admin, /err instanceof CatalogUnavailable/)
  assert.match(admin, /code: 503, message: err\.message \}, 503/)
})

test('目录价导入平台刊例价：计费类型映射 + 只补空缺 + USD 折算 + dry-run', () => {
  const svc = readModelCatalogSources(root)
  // 写入目标为平台主库 model_prices（复用 drizzle db/schema）
  assert.match(svc, /import \{ db, schema \} from '\.\.\/db\/index\.js'/)
  assert.match(svc, /db\.insert\(schema\.modelPrices\)/)
  // 计费类型优先级：视频(每秒) > 图片(每张) > token(输入/输出)
  assert.match(svc, /function buildPlan/)
  assert.match(svc, /billing_type: 'video_second'/)
  assert.match(svc, /billing_type: 'image'/)
  assert.match(svc, /billing_type: 'token'/)
  // 仅取在售价格行聚合；token 输入/输出排除缓存/思考/Batch 变体
  assert.match(svc, /FROM prices WHERE \(is_offline = 0 OR is_offline IS NULL\)/)
  assert.match(svc, /\\u7f13\\u5b58\|\\u601d\\u8003\|batch/)
  // onlyMissing：按 model 名去重，已存在不覆盖；多档取最低价
  assert.match(svc, /const existing = new Set\(\(await db\.select\(\{ model: schema\.modelPrices\.model \}/)
  assert.match(svc, /if \(existing\.has\(plan\.model\)\) \{ skipped_existing\+\+; continue \}/)
  assert.match(svc, /Math\.min\(\.\.\./)
  // USD 按汇率折算（默认 7.2），dry-run 仅预览不落库
  assert.match(svc, /opts\.usdRate && opts\.usdRate > 0 \? opts\.usdRate : 7\.2/)
  assert.match(svc, /isUsd\(r\) \? usdRate : 1/)
  assert.match(svc, /if \(opts\.dryRun\) return result/)

  const admin = readAdminSources(new URL('..', import.meta.url))
  assert.match(admin, /app\.post\('\/model-catalog\/import'/)
  assert.match(admin, /importCatalogPrices\(\{ usdRate, dryRun:/)
})
