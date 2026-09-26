/*
 * Drama Mill — AI 短剧自动化生产平台 (https://github.com/your-org/drama-mill)
 * Copyright (C) 2026 Drama Mill <52859273@qq.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import 'dotenv/config'
import fs from 'fs'
import mysql from 'mysql2/promise'
import { drizzle } from 'drizzle-orm/mysql2'
import * as schema from './schema.js'
import { initMySqlSchema, runMysqlDataSeeds } from './mysql-schema.js'
import { runMigrationsAndSeed } from './migrations.js'

// 容器内 127.0.0.1 指向容器自身;未显式配置时默认指向宿主机
// (Linux 需 --add-host=host.docker.internal:host-gateway 才能解析)
const inContainer = fs.existsSync('/.dockerenv')
const usingDefaultHost = !process.env.DATABASE_URL && !process.env.MYSQL_HOST

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL

  const host = process.env.MYSQL_HOST || (inContainer ? 'host.docker.internal' : '127.0.0.1')
  const port = process.env.MYSQL_PORT || '3306'
  const user = encodeURIComponent(process.env.MYSQL_USER || 'dramamill')
  const password = encodeURIComponent(process.env.MYSQL_PASSWORD || 'dramamill_tool')
  const database = process.env.MYSQL_DATABASE || 'drama_mill'
  return `mysql://${user}:${password}@${host}:${port}/${database}`
}

export const pool = mysql.createPool({
  uri: databaseUrl(),
  waitForConnections: true,
  // 默认 30：高并发轮询/批量写入时，10 个连接 + 无界排队会把包括健康检查在内的所有请求拖死（云端小规格机已复现两次）
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 30),
  // 排队上限 200：超限快速报错而非无限挂起，避免事件循环看似“冻结”
  queueLimit: Number(process.env.MYSQL_QUEUE_LIMIT || 200),
  charset: 'utf8mb4',
})

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** 启动建表带重试：Docker 部署时 MySQL 容器就绪晚于应用启动，直接失败会导致进程崩溃 */
export async function initDb(retries = 10, delayMs = 3000) {
  for (let attempt = 1; ; attempt++) {
    try {
      await initMySqlSchema(pool)
      // 增量迁移与种子（补 user_id 列、种子账号、存量回填、刊例价）
      await runMigrationsAndSeed(pool)
      // 风格预设种子依赖迁移补的 user_id 列，必须放在迁移之后（存量库先种子会报缺列）
      await runMysqlDataSeeds(pool)
      return
    } catch (err) {
      if (attempt >= retries) throw err
      console.warn(`[db] init failed (attempt ${attempt}/${retries}), retrying in ${delayMs}ms: ${(err as Error).message}`)
      if (attempt === 1 && usingDefaultHost && inContainer) {
        console.warn('[db] 未配置数据库连接:容器内默认尝试宿主机 host.docker.internal:3306。' +
          '如使用独立 MySQL 容器或外部数据库,请设置 DATABASE_URL 或 MYSQL_HOST 环境变量')
      }
      await sleep(delayMs)
    }
  }
}

export function getInsertId(result: unknown) {
  const packet = Array.isArray(result) ? result[0] : result
  const insertId = (packet as { insertId?: number | string } | undefined)?.insertId
  if (insertId === undefined || insertId === null) {
    throw new Error('MySQL insert did not return an insertId')
  }
  return Number(insertId)
}

await initDb()

export const db = drizzle(pool, { schema, mode: 'default' })
export { schema }
export type DB = typeof db
