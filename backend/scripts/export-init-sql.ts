/*
 * Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
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

/**
 * init.sql 导出器：将 src/db/mysql-schema.ts 的内嵌 DDL/种子语句落为独立 SQL 文件
 *
 * 用法: npx tsx scripts/export-init-sql.ts [输出路径]（缺省 <repo>/docker/init.sql）
 * 产物仅供 DBA 审核、外部预建表或挂进 MySQL 容器 initdb 目录；
 * 应用启动时 initMySqlSchema 会执行同样的幂等初始化，部署并不依赖本文件
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { mysqlDataSeedStatements, mysqlSchemaStatements } from '../src/db/mysql-schema.js'

const here = path.dirname(fileURLToPath(import.meta.url))
// 命令行第一参可覆盖输出路径；缺省写到仓库根的 docker/init.sql
const target = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(here, '../../docker/init.sql')

/** 种子语句里的 ? 占位内联成 SQL 字面量（静态导出场景，不需要参数化） */
function inlineParams(text: string, values: unknown[]): string {
  let cursor = 0
  const filled = text.replace(/\?/g, () => {
    const v = values[cursor++]
    if (v === null || v === undefined) return 'NULL'
    if (typeof v === 'number') return String(v)
    return `'${String(v).replace(/'/g, "''")}'`
  })
  if (cursor !== values.length) throw new Error(`参数数量与占位符不匹配: ${text}`)
  return filled
}

const bar = '-- ' + '-'.repeat(72)
const pieces: string[] = []

// 文件头：来源说明 + 生成时间戳（分隔行必须带 -- 注释前缀，否则 mysql 客户端整跑报错）
pieces.push([
  '-- ' + '='.repeat(72),
  '-- Drama Mill 数据库初始化脚本（生成物，请勿手改）',
  '-- 来源: backend/src/db/mysql-schema.ts',
  '-- 导出: backend/scripts/export-init-sql.ts',
  `-- 时间: ${new Date().toISOString()}`,
  '-- 说明: 应用启动自带幂等初始化，本脚本仅用于审核/预建表',
  '-- ' + '='.repeat(72),
  '',
  'SET NAMES utf8mb4;',
].join('\n'))

// 建表段：DDL 逐条加分号空行分隔
pieces.push([
  bar,
  `-- 建表语句（共 ${mysqlSchemaStatements.length} 张）`,
  bar,
  ...mysqlSchemaStatements.map(s => `${s};\n`),
].join('\n'))

// 种子段：风格预设，幂等补行
pieces.push([
  bar,
  '-- 种子数据（风格预设，INSERT 只补缺失行）',
  bar,
  ...mysqlDataSeedStatements.map(s => `${inlineParams(s.sql, s.params)};`),
].join('\n'))

fs.mkdirSync(path.dirname(target), { recursive: true })
fs.writeFileSync(target, pieces.join('\n') + '\n', 'utf8')
console.log(`✅ 已导出: ${target}`)
console.log(`   建表 ${mysqlSchemaStatements.length} 条 / 种子 ${mysqlDataSeedStatements.length} 条`)
