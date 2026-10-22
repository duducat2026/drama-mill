import { readMigrationsSources } from './helpers/migrations-sources.mjs'
import { readStorageSources } from './helpers/storage-sources.mjs'
import { readAdminSources } from './helpers/admin-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readGenerationSources } from './helpers/generation-sources.mjs'
import { readEpisodeRouteSources } from './helpers/episode-route-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const migrations = readMigrationsSources(root)
const authMiddleware = read('src/middleware/auth.ts')
const auditMiddleware = read('src/middleware/audit.ts')
const indexTs = read('src/index.ts')
const adminRoutes = readAdminSources(new URL('..', import.meta.url))
const authRoutes = read('src/routes/auth.ts')
const stageTiming = read('src/utils/stage-timing.ts')
const costService = read('src/services/cost.ts')
const costRoutes = read('src/routes/costs.ts')
const storage = readStorageSources(root)
const generation = readGenerationSources(root)
const uploadRoute = read('src/routes/upload.ts')

test('seed users include platform admin and regular account', () => {
  assert.match(migrations, /SEED_USERS/)
  assert.match(migrations, /username: 'drama-mill'/)
  assert.match(migrations, /username: 'test'/)
  assert.match(migrations, /password: 'drama-mill'/)
  assert.match(migrations, /role: 'admin'/)
  // 旧账号名 adimin 幂等重命名为 admin（存量库兼容）
  assert.match(migrations, /renameLegacyAdmin/)
  // 旧个人账号名 kongqz 幂等重命名为 test（保留主键 id，存量归属不断）
  assert.match(migrations, /renameLegacyUser/)
  // 管理员播种护栏：库内已有管理员则不新建，避免给存量部署塞入默认口令管理员
  assert.match(migrations, /hasAnyAdmin/)
})

test('auth routes and middleware guard all api paths', () => {
  assert.match(authRoutes, /\/auth\/login/)
  assert.match(authMiddleware, /AUTH_WHITELIST = \['\/api\/v1\/health', '\/api\/v1\/auth\/login'\]/)
  assert.match(read('src/services/auth.ts'), /JWT_SECRET/)
  // 全局挂载：认证 + 审计
  assert.match(indexTs, /api\.use\('\*', authMiddleware\)/)
  assert.match(indexTs, /api\.use\('\*', auditMiddleware\)/)
})

test('audit middleware masks sensitive fields', () => {
  assert.match(auditMiddleware, /SENSITIVE_KEY/)
  assert.match(auditMiddleware, /parsed\[key\] = '\*\*\*'/)
})

test('stage timings record per-stage duration and episode total', () => {
  assert.match(stageTiming, /export (async )?function getEpisodeTimings/)
  assert.match(stageTiming, /duration_ms/)
  assert.match(stageTiming, /total_duration_ms/)
  assert.match(readEpisodeRouteSources(root), /app\.get\('\/:id\/timings'/)
})

test('cost platform records usage and aggregates costs', () => {
  assert.match(costService, /export async function recordTextUsage/)
  assert.match(costService, /export async function recordImageUsage/)
  assert.match(costService, /export async function recordVideoUsage/)
  assert.match(costService, /export async function aggregateCosts/)
  assert.match(costService, /total_cost/)
  assert.match(costService, /by_drama/)
  assert.match(costService, /by_episode/)
  assert.match(costRoutes, /aggregateCosts\(\{ userId: user\.id/)
})

test('storage roots are isolated per media category', () => {
  assert.match(storage, /CATEGORY_DIRS/)
  assert.match(storage, /process\.env\.ASSET_PATH/)
  assert.match(storage, /process\.env\.VIDEO_PATH/)
  assert.match(storage, /process\.env\.MERGED_PATH/)
  assert.match(storage, /process\.env\.UPLOAD_PATH/)
})

test('generation scheduler adapts to gateway rate limits', () => {
  assert.match(generation, /gatewayGates/)
  assert.match(generation, /paceSubmission/)
  assert.match(generation, /onGatewayRateLimited/)
  assert.match(generation, /onGatewaySuccess/)
  assert.match(generation, /submitWithRetry/)
  assert.match(generation, /getGatewayRateStats/)
})

test('upload route accepts txt, md and docx source documents', () => {
  assert.match(uploadRoute, /mammoth/)
  assert.match(uploadRoute, /DOC_EXT/)
  assert.match(uploadRoute, /app\.post\('\/document'/)
  assert.match(uploadRoute, /decodeTextBuffer/)
})

test('admin routes expose the 11 management capabilities', () => {
  assert.match(adminRoutes, /adminGuard/)
  assert.match(adminRoutes, /function paged/)
  assert.match(adminRoutes, /maskApiKey/)
  // 用户管理 / 资产 / AI 配置 / 审计 / 生产面板 / 成本 / 模型目录价（刊例价不再单独维护）
  assert.match(adminRoutes, /app\.get\('\/users'/)
  assert.match(adminRoutes, /app\.post\('\/users'/)
  assert.match(adminRoutes, /app\.get\('\/assets'/)
  assert.match(adminRoutes, /app\.get\('\/ai-configs'/)
  assert.match(adminRoutes, /app\.get\('\/audit'/)
  assert.match(adminRoutes, /app\.get\('\/panel'/)
  assert.match(adminRoutes, /app\.get\('\/costs'/)
  assert.match(adminRoutes, /app\.get\('\/model-catalog\/stats'/)
  // 平台内容查看
  assert.match(adminRoutes, /app\.get\('\/dramas'/)
  assert.match(adminRoutes, /app\.get\('\/storyboards'/)
  assert.match(adminRoutes, /app\.get\('\/videos'/)
  assert.match(adminRoutes, /app\.get\('\/merges'/)
})

test('admin assets aggregates real asset tables instead of the dead assets table', () => {
  // assets 表为历史遗留死表（全代码库无写入点），资产管理接口禁止回退查它（admin 路由已拆分，直接读 assets 子路由）
  const assetSection = read('src/routes/admin/assets.ts')
  assert.doesNotMatch(assetSection, /from\(schema\.assets\)/)
  // 真实资产落在 characters/scenes/props/storyboards 四张表聚合，条件全部下推 SQL
  assert.match(assetSection, /from\(schema\.characters\)/)
  assert.match(assetSection, /from\(schema\.scenes\)/)
  assert.match(assetSection, /from\(schema\.props\)/)
  assert.match(assetSection, /from\(schema\.storyboards\)/)
  assert.match(assetSection, /innerJoin\(schema\.episodes/)
  assert.match(assetSection, /ADMIN_ASSET_SOURCE_LIMIT/)
})
