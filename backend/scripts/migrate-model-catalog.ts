/*
 * Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
 * Copyright (C) 2026 Drama Mill <52859273@qq.com>
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

/**
 * 模型目录迁移脚本（部署期一次性工具，非运行时链路）—
 * 将外部 model_list 库的 models / prices 全量收编进主库 model_catalog_models / model_catalog_prices。
 *
 * 用法: npx tsx scripts/migrate-model-catalog.ts [--source-database=model_list]
 * - 源/目标共用 MYSQL_* 业务账号（对目录库只读、对主库全权限）；主库名取 MYSQL_DATABASE
 * - 按 id upsert（INSERT ... ON DUPLICATE KEY UPDATE），幂等可重跑；大字段 raw_json/price_raw 不带入
 * - 运行时业务不再访问 model_list：本脚本是唯一合法的外部目录库读取入口
 */
import 'dotenv/config'
import mysql from 'mysql2/promise'
import { mysqlSchemaPlatformStatements } from '../src/db/mysql-schema-platform.js'

const BATCH = 500

// 与主库目录表一致的精简列清单（snake_case，顺序即 INSERT 顺序）
const MODELS_COLS = [
  'id', 'name', 'model_id', 'provider', 'inference_provider', 'source', 'source_url',
  'context_window', 'max_input_tokens', 'max_output_tokens', 'request_modality', 'response_modality',
  'features', 'description', 'published_time', 'offline_time', 'is_offline', 'extracted_at',
]
const PRICES_COLS = [
  'id', 'model_name', 'model_id', 'provider', 'inference_provider', 'cap_zh', 'range_name',
  'price_name', 'price_type', 'price', 'price_unit', 'time_band', 'currency', 'unit_price_cny',
  'unit_cny', 'billing_mode', 'spec', 'price_kind', 'source', 'source_url', 'is_offline', 'extracted_at',
]

function envOverride(argName: string, fallback: string) {
  const hit = process.argv.find((a) => a.startsWith(`--${argName}=`))
  return hit ? hit.split('=')[1] : fallback
}

const base = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'dramamill',
  password: process.env.MYSQL_PASSWORD || '',
  charset: 'utf8mb4',
}
const sourceDb = envOverride('source-database', 'model_list')
const targetDb = process.env.MYSQL_DATABASE || 'drama_mill'

const sqlIdent = (cols: string[]) => cols.map((c) => `\`${c}\``).join(', ')

/** 目标表建表：复用 platform DDL 中 model_catalog_* 两条（幂等） */
async function ensureTargetTables(conn: mysql.Connection) {
  const ddls = mysqlSchemaPlatformStatements.filter((s) => s.includes('CREATE TABLE IF NOT EXISTS model_catalog_'))
  if (ddls.length !== 2) throw new Error(`platform DDL 中未找到两条 model_catalog 建表语句（实际 ${ddls.length} 条）`)
  for (const ddl of ddls) await conn.query(ddl)
}

/** 分批读源表 → 按 id upsert 写目标表；返回迁移行数 */
async function migrateTable(
  src: mysql.Connection,
  dst: mysql.Connection,
  fromTable: string,
  toTable: string,
  cols: string[],
): Promise<number> {
  const colsSql = sqlIdent(cols)
  const placeholders = cols.map(() => '?').join(', ')
  const updateSql = cols.filter((c) => c !== 'id').map((c) => `\`${c}\`=VALUES(\`${c}\`)`).join(', ')
  let migrated = 0
  for (let offset = 0; ; offset += BATCH) {
    const [rows] = await src.query(
      `SELECT ${colsSql} FROM \`${fromTable}\` ORDER BY id ASC LIMIT ${BATCH} OFFSET ${offset}`,
    )
    const batch = rows as Record<string, unknown>[]
    if (!batch.length) break
    for (const r of batch) {
      await dst.query(
        `INSERT INTO \`${toTable}\` (${colsSql}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updateSql}`,
        cols.map((c) => r[c] ?? null),
      )
    }
    migrated += batch.length
    console.log(`  ${toTable}: 已迁移 ${migrated} 行`)
    if (batch.length < BATCH) break
  }
  return migrated
}

async function main() {
  const src = await mysql.createConnection({ ...base, database: sourceDb })
  const dst = await mysql.createConnection({ ...base, database: targetDb })
  try {
    console.log(`模型目录收编：${sourceDb} → ${targetDb}`)
    await ensureTargetTables(dst)
    const models = await migrateTable(src, dst, 'models', 'model_catalog_models', MODELS_COLS)
    const prices = await migrateTable(src, dst, 'prices', 'model_catalog_prices', PRICES_COLS)
    const [mcRows] = await dst.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS c FROM model_catalog_models')
    const [pcRows] = await dst.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS c FROM model_catalog_prices')
    console.log(`完成：本次迁移 models ${models} 行 / prices ${prices} 行；主库现存量 ${mcRows[0].c} / ${pcRows[0].c}`)
  } finally {
    await src.end()
    await dst.end()
  }
}

main().catch((err) => {
  console.error('迁移失败：', (err as Error).message)
  process.exit(1)
})
