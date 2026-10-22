/*
 * Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
 * Copyright (C) 2026 Drama Mill <52859273@qq.com>
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

/**
 * 模型目录数据快照导出器 — 把主库 model_catalog_models / model_catalog_prices 全量
 * 导出为独立 SQL 文件随仓库发布，使 GitHub 下载者（无法访问外部采集库）也能一键初始化目录数据。
 *
 * 用法: npx tsx scripts/export-catalog-sql.ts [输出路径]（缺省 <repo>/docker/model-catalog-data.sql）
 * - 产物自含两条 CREATE TABLE IF NOT EXISTS（可先于应用建表执行），INSERT 按主键 id upsert 幂等可重跑
 * - docker-compose 部署时经 /docker-entrypoint-initdb.d/02-* 首次自动加载；PM2 部署手动导入即可
 * - 数据刷新链路：先跑 migrate-model-catalog.ts 收编最新采集库，再跑本脚本重导出快照
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mysql from 'mysql2/promise'
import { mysqlSchemaPlatformStatements } from '../src/db/mysql-schema-platform.js'

const BATCH = 500

// 与 schema-catalog.ts / migrate-model-catalog.ts 列清单一致（snake_case，顺序即 INSERT 顺序）
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

const here = path.dirname(fileURLToPath(import.meta.url))
const target = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(here, '../../docker/model-catalog-data.sql')

/** 值 → SQL 字面量：布尔归一 0/1，字符串走 mysql2 escape（引号/反斜杠安全） */
function lit(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (typeof v === 'number') return String(v)
  return mysql.escape(String(v))
}

const sqlIdent = (cols: string[]) => cols.map((c) => `\`${c}\``).join(', ')

/** 一批 rows → 一条多值 INSERT ... ON DUPLICATE KEY UPDATE（幂等） */
function insertStatement(table: string, cols: string[], rows: Record<string, unknown>[]): string {
  const updateSql = cols.filter((c) => c !== 'id').map((c) => `\`${c}\`=VALUES(\`${c}\`)`).join(', ')
  const values = rows.map((r) => `(${cols.map((c) => lit(r[c])).join(', ')})`).join(',\n')
  return `INSERT INTO \`${table}\` (${sqlIdent(cols)}) VALUES\n${values}\nON DUPLICATE KEY UPDATE ${updateSql};`
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'dramamill',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'drama_mill',
    charset: 'utf8mb4',
  })
  try {
    const ddls = mysqlSchemaPlatformStatements.filter((s) => s.includes('CREATE TABLE IF NOT EXISTS model_catalog_'))
    if (ddls.length !== 2) throw new Error(`platform DDL 中未找到两条 model_catalog 建表语句（实际 ${ddls.length} 条）`)

    const pieces: string[] = [
      '-- ' + '='.repeat(72),
      '-- Drama Mill AI 模型目录数据快照（生成物，请勿手改）',
      '-- 来源: 主库 drama_mill.model_catalog_models / model_catalog_prices（自外部采集库收编）',
      '-- 导出: backend/scripts/export-catalog-sql.ts',
      `-- 时间: ${new Date().toISOString()}`,
      '-- 用法: mysql drama_mill < docker/model-catalog-data.sql（compose 部署首次初始化自动加载）',
      '-- 幂等: 建表 IF NOT EXISTS + 按主键 id upsert，可安全重跑',
      '-- ' + '='.repeat(72),
      '',
      'SET NAMES utf8mb4;',
      '',
      ddls.map((d) => `${d};`).join('\n\n'),
    ]

    const counts: string[] = []
    for (const { table, cols } of [
      { table: 'model_catalog_models', cols: MODELS_COLS },
      { table: 'model_catalog_prices', cols: PRICES_COLS },
    ]) {
      const [rows] = await conn.query(`SELECT ${sqlIdent(cols)} FROM \`${table}\` ORDER BY id ASC`)
      const batch = rows as Record<string, unknown>[]
      counts.push(`${table} ${batch.length} 行`)
      pieces.push(`\n-- ${'-'.repeat(72)}\n-- ${table}（${batch.length} 行，每批 ${BATCH}）\n-- ${'-'.repeat(72)}`)
      for (let i = 0; i < batch.length; i += BATCH) {
        pieces.push(insertStatement(table, cols, batch.slice(i, i + BATCH)))
      }
    }

    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, pieces.join('\n') + '\n', 'utf8')
    const kb = (fs.statSync(target).size / 1024).toFixed(0)
    console.log(`✅ 已导出: ${target}（${counts.join(' / ')}，${kb} KB）`)
  } finally {
    await conn.end()
  }
}

main().catch((err) => {
  console.error('导出失败：', (err as Error).message)
  process.exit(1)
})
