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

/**
 * MySQL schema 门面：合并内容/平台两组 DDL 并按序执行；种子在 mysql-schema-seeds.ts。
 */
import type { Pool } from 'mysql2/promise'
import { mysqlSchemaContentStatements } from './mysql-schema-content.js'
import { mysqlSchemaPlatformStatements } from './mysql-schema-platform.js'

export { mysqlSchemaContentStatements } from './mysql-schema-content.js'
export { mysqlSchemaPlatformStatements } from './mysql-schema-platform.js'
export {
  mysqlDataSeedStatements,
  novelSplitTemplateSeeds,
  stylePresetSeeds,
} from './mysql-schema-seeds.js'

/** 完整建表语句列表：内容 → 平台，保持与旧实现一致的顺序 */
export const mysqlSchemaStatements: string[] = [
  ...mysqlSchemaContentStatements,
  ...mysqlSchemaPlatformStatements,
]

export async function initMySqlSchema(pool: Pool) {
  for (const statement of mysqlSchemaStatements) {
    await pool.query(statement)
  }
}

/**
 * 数据种子：依赖增量迁移补的列（如 style_presets.user_id），
 * 必须在 runMigrationsAndSeed 之后执行，否则存量库建表后即种子会因缺列报错。
 */
export async function runMysqlDataSeeds(pool: Pool) {
  const { mysqlDataSeedStatements } = await import('./mysql-schema-seeds.js')
  for (const seed of mysqlDataSeedStatements) {
    await pool.query(seed.sql, seed.params)
  }
}
