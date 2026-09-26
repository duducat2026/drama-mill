import 'dotenv/config'
import fs from 'fs'
import mysql from 'mysql2/promise'

/**
 * 模型目录价服务 · 检索侧 — 从独立的 model_list 数据库只读提取「模型清单」与「模型价格列表」
 *
 * 数据来源：本地 MySQL 的 model_list 库（models / prices 两张表），
 * 由外部采集流水线维护，平台侧只做只读检索与展示（不参与业务计费）。
 *
 * 连接凭据默认复用主库的 MYSQL_* 配置（同实例、同业务账号），库名指向 model_list；
 * 可用 MODEL_LIST_HOST/PORT/USER/PASSWORD/DATABASE 单独覆盖，适配目录库与业务库分部署的场景。
 */

// 容器内 127.0.0.1 指向容器自身：未显式配置目录库主机时，容器环境默认指向宿主机
const inContainer = typeof process.env.MYSQL_HOST === 'undefined' && fs.existsSync('/.dockerenv')

function catalogUrl() {
  const host = process.env.MODEL_LIST_HOST || process.env.MYSQL_HOST || (inContainer ? 'host.docker.internal' : '127.0.0.1')
  const port = process.env.MODEL_LIST_PORT || process.env.MYSQL_PORT || '3306'
  const user = process.env.MODEL_LIST_USER || process.env.MYSQL_USER || 'dramamill'
  const password = process.env.MODEL_LIST_PASSWORD || process.env.MYSQL_PASSWORD || ''
  const database = process.env.MODEL_LIST_DATABASE || 'model_list'
  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`
}

let poolPromise: Promise<mysql.Pool> | null = null

/** 懒建连接池：目录库不可达时只在接口调用时抛错，不影响主服务启动 */
function getPool(): Promise<mysql.Pool> {
  if (!poolPromise) {
    poolPromise = Promise.resolve(
      mysql.createPool({
        uri: catalogUrl(),
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 50,
        charset: 'utf8mb4',
      }),
    )
  }
  return poolPromise
}

export async function query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const pool = await getPool()
  const [rows] = await pool.query(sql, params)
  return rows as T[]
}

export type CatalogPaged<T> = { total: number; page: number; page_size: number; items: T[] }

/** 目录价接口统一错误封装：区分「目录库不可达」与查询语法错误，给出可操作提示 */
export class CatalogUnavailable extends Error {}

export function wrapError(err: unknown): Error {
  const msg = (err as Error)?.message || String(err)
  if (/ECONNREFUSED|ENOTFOUND|ER_ACCESS_DENIED|ER_NO_SUCH_TABLE|PROTOCOL_CONNECTION|ETIMEDOUT|ER_HOST_NOT_PRIVILEGED|Access denied/i.test(msg)) {
    return new CatalogUnavailable(`模型目录库（model_list）不可达：${msg}`)
  }
  return err as Error
}

// models 表列表投影：不携带 raw_json / inference_metadata_raw 等大字段
const MODEL_COLUMNS = `id, name, model_id, provider, inference_provider, source, source_url,
  context_window, max_input_tokens, max_output_tokens, request_modality, response_modality,
  features, description, published_time, offline_time, is_offline, extracted_at`

export type CatalogFilter = {
  keyword?: string
  provider?: string
  source?: string
  offline?: string // '' 全部 | '1' 仅下线 | '0' 仅在售
  page: number
  pageSize: number
}

/** 模型清单：models 表分页检索（名称/模型ID/厂商 模糊匹配） */
export async function listCatalogModels(f: CatalogFilter): Promise<CatalogPaged<any>> {
  const conds: string[] = []
  const params: unknown[] = []
  if (f.keyword) {
    conds.push('(LOWER(name) LIKE ? OR LOWER(model_id) LIKE ? OR LOWER(provider) LIKE ?)')
    const kw = `%${f.keyword.toLowerCase()}%`
    params.push(kw, kw, kw)
  }
  if (f.provider) { conds.push('provider = ?'); params.push(f.provider) }
  if (f.source) { conds.push('source = ?'); params.push(f.source) }
  if (f.offline === '1') conds.push('is_offline = 1')
  else if (f.offline === '0') conds.push('is_offline = 0')
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  try {
    const [cntRow] = await query<{ c: number }>(`SELECT COUNT(*) AS c FROM models ${where}`, params)
    const total = Number(cntRow?.c) || 0
    const offset = (f.page - 1) * f.pageSize
    const items = total
      ? await query(`SELECT ${MODEL_COLUMNS} FROM models ${where} ORDER BY is_offline ASC, provider ASC, name ASC LIMIT ? OFFSET ?`,
        [...params, f.pageSize, offset])
      : []
    return { total, page: f.page, page_size: f.pageSize, items }
  } catch (err) {
    throw wrapError(err)
  }
}

// prices 表列表投影：不携带 price_raw 大字段
const PRICE_COLUMNS = `id, model_name, model_id, provider, inference_provider, cap_zh, range_name,
  price_name, price_type, price, price_unit, time_band, currency, unit_price_cny, unit_cny,
  billing_mode, spec, price_kind, source, source_url, is_offline, extracted_at`

export async function listCatalogPrices(f: CatalogFilter & { modelId?: string }): Promise<CatalogPaged<any>> {
  const conds: string[] = []
  const params: unknown[] = []
  if (f.keyword) {
    conds.push('(LOWER(model_name) LIKE ? OR LOWER(model_id) LIKE ? OR LOWER(provider) LIKE ? OR LOWER(price_name) LIKE ?)')
    const kw = `%${f.keyword.toLowerCase()}%`
    params.push(kw, kw, kw, kw)
  }
  if (f.modelId) { conds.push('model_id = ?'); params.push(f.modelId) }
  if (f.provider) { conds.push('provider = ?'); params.push(f.provider) }
  if (f.source) { conds.push('source = ?'); params.push(f.source) }
  if (f.offline === '1') conds.push('is_offline = 1')
  else if (f.offline === '0') conds.push('is_offline = 0')
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  try {
    const [cntRow] = await query<{ c: number }>(`SELECT COUNT(*) AS c FROM prices ${where}`, params)
    const total = Number(cntRow?.c) || 0
    const offset = (f.page - 1) * f.pageSize
    const items = total
      ? await query(`SELECT ${PRICE_COLUMNS} FROM prices ${where} ORDER BY model_id ASC, id ASC LIMIT ? OFFSET ?`,
        [...params, f.pageSize, offset])
      : []
    return { total, page: f.page, page_size: f.pageSize, items }
  } catch (err) {
    throw wrapError(err)
  }
}

/** 单个模型的价格明细（点模型清单行时按 model_id 拉取） */
export async function pricesOfModel(modelId: string): Promise<any[]> {
  try {
    return await query(`SELECT ${PRICE_COLUMNS} FROM prices WHERE model_id = ? ORDER BY id ASC`, [modelId])
  } catch (err) {
    throw wrapError(err)
  }
}

/** 目录概览：模型数 / 价格条数 / 厂商与来源分布（用于页头统计与筛选下拉） */
export async function catalogStats() {
  try {
    const [modelCnt, priceCnt, providers, sources] = await Promise.all([
      query<{ c: number }>('SELECT COUNT(*) AS c FROM models'),
      query<{ c: number }>('SELECT COUNT(*) AS c FROM prices'),
      query<{ provider: string; c: number }>('SELECT provider, COUNT(*) AS c FROM models WHERE provider IS NOT NULL GROUP BY provider ORDER BY c DESC'),
      query<{ source: string; c: number }>('SELECT source, COUNT(*) AS c FROM models WHERE source IS NOT NULL GROUP BY source ORDER BY c DESC'),
    ])
    return {
      model_total: Number(modelCnt[0]?.c) || 0,
      price_total: Number(priceCnt[0]?.c) || 0,
      providers: providers.map(p => ({ provider: p.provider, count: Number(p.c) || 0 })),
      sources: sources.map(s => ({ source: s.source, count: Number(s.c) || 0 })),
    }
  } catch (err) {
    throw wrapError(err)
  }
}
