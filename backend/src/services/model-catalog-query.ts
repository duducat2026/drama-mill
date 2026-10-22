/**
 * Drama Mill — AI 短剧生成平台
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */

/**
 * 模型目录价服务 · 检索侧 — 目录数据已收编进主库 model_catalog_models / model_catalog_prices
 * （部署期由 scripts/migrate-model-catalog.ts 从外部 model_list 库一次性迁入，运行时零外部库依赖）。
 *
 * 对 admin 暴露三个只读能力：目录概览、价格列表分页、价格批量删除；
 * 均走主库 drizzle，COUNT + LIMIT/OFFSET 分页，过滤参数全部经占位符绑定（防注入）。
 * keyword 匹配依赖列的 utf8mb4_unicode_ci 排序规则，大小写不敏感，与原 LOWER LIKE 等价。
 * 目录价即刊例价：本表实时派生为平台计价来源（见 cost-price-lookup），批量删除即退出计价。
 */
import { and, desc, eq, inArray, isNotNull, like, or, sql, type SQL } from 'drizzle-orm'
import type { MySqlColumn } from 'drizzle-orm/mysql-core'
import { db, schema } from '../db/index.js'
import { toSnakeCase } from '../utils/transform.js'

const M = schema.modelCatalogModels
const P = schema.modelCatalogPrices

export type CatalogPaged<T> = { total: number; page: number; page_size: number; items: T[] }

/** 目录表未初始化（迁移脚本还没跑）：接口层沿用 503 提示，语义替代原「目录库不可达」 */
export class CatalogUnavailable extends Error {}

async function guardInitialized(): Promise<void> {
  const [row] = await db.select({ c: sql<number>`COUNT(*)` }).from(M)
  if (!Number(row?.c)) {
    throw new CatalogUnavailable('模型目录表尚未初始化：请导入仓库自带快照 docker/model-catalog-data.sql（或在有采集库的环境运行 backend/scripts/migrate-model-catalog.ts）')
  }
}

export type CatalogFilter = {
  keyword?: string
  provider?: string
  source?: string
  offline?: string // '' 全部 | '1' 仅下线 | '0' 仅在售
  page: number
  pageSize: number
}

/** 两表列名不同（models.name vs prices.model_name），过滤条件按传入列引用组装 */
type FilterCols = {
  name: MySqlColumn
  modelId: MySqlColumn
  provider: MySqlColumn
  source: MySqlColumn
  isOffline: MySqlColumn
  priceName?: MySqlColumn
}

function buildWhere(f: CatalogFilter, cols: FilterCols, modelId?: string) {
  const conds: (SQL | undefined)[] = []
  const kw = f.keyword?.trim()
  if (kw) {
    const likes = [like(cols.name, `%${kw}%`), like(cols.modelId, `%${kw}%`), like(cols.provider, `%${kw}%`)]
    if (cols.priceName) likes.push(like(cols.priceName, `%${kw}%`))
    conds.push(or(...likes))
  }
  if (modelId) conds.push(eq(cols.modelId, modelId))
  if (f.provider) conds.push(eq(cols.provider, f.provider))
  if (f.source) conds.push(eq(cols.source, f.source))
  if (f.offline === '1') conds.push(eq(cols.isOffline, true))
  else if (f.offline === '0') conds.push(eq(cols.isOffline, false))
  const filled = conds.filter(Boolean) as SQL[]
  return filled.length ? and(...filled) : undefined
}

/** 模型价格列表：model_catalog_prices 分页检索（keyword 额外匹配价格项名） */
export async function listCatalogPrices(f: CatalogFilter & { modelId?: string }): Promise<CatalogPaged<any>> {
  await guardInitialized()
  const where = buildWhere(f, { name: P.modelName, modelId: P.modelId, provider: P.provider, source: P.source, isOffline: P.isOffline, priceName: P.priceName }, f.modelId?.trim() || undefined)
  const [cnt] = await db.select({ c: sql<number>`COUNT(*)` }).from(P).where(where)
  const total = Number(cnt?.c) || 0
  const items = total
    ? (await db.select().from(P).where(where)
        .orderBy(P.modelId, P.id)
        .limit(f.pageSize).offset((f.page - 1) * f.pageSize)).map(toSnakeCase)
    : []
  return { total, page: f.page, page_size: f.pageSize, items }
}

/**
 * 批量删除目录价格条目：删除选中的 model_catalog_prices 行即直接退出计价
 * （目录价即刊例价，查价从目录表实时派生，无需清理任何副本表）。
 */
export async function batchDeleteCatalogPrices(ids: number[]): Promise<{ catalog_deleted: number }> {
  await guardInitialized()
  const [del] = await db.delete(P).where(inArray(P.id, ids))
  return { catalog_deleted: (del as any)?.affectedRows ?? ids.length }
}

/** 目录概览：模型数 / 价格条数 / 厂商与来源分布（用于页头统计与筛选下拉） */
export async function catalogStats() {
  await guardInitialized()
  const [modelCnt, priceCnt, providers, sources] = await Promise.all([
    db.select({ c: sql<number>`COUNT(*)` }).from(M),
    db.select({ c: sql<number>`COUNT(*)` }).from(P),
    db.select({ provider: M.provider, c: sql<number>`COUNT(*) AS c` }).from(M)
      .where(isNotNull(M.provider)).groupBy(M.provider).orderBy(desc(sql`c`)),
    db.select({ source: M.source, c: sql<number>`COUNT(*) AS c` }).from(M)
      .where(isNotNull(M.source)).groupBy(M.source).orderBy(desc(sql`c`)),
  ])
  return {
    model_total: Number(modelCnt[0]?.c) || 0,
    price_total: Number(priceCnt[0]?.c) || 0,
    providers: providers.map(p => ({ provider: p.provider, count: Number(p.c) || 0 })),
    sources: sources.map(s => ({ source: s.source, count: Number(s.c) || 0 })),
  }
}
