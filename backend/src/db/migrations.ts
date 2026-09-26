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
 * 增量迁移与种子数据 — 对已存在的库做幂等升级：
 * 1) 存量表补 user_id 列与索引（多租户）
 * 2) 种子账号：管理员 drama-mill / 普通用户 test（库内已有管理员则跳过管理员播种）
 * 3) 存量数据归属回填（user_id 为空 → test）
 * 4) 阿里云百炼刊例价种子（AI 成本核算）
 *
 * 分层：migrations-columns.ts（幂等列/索引工具 + 表结构升级）· migrations-seed.ts（种子/回填/刊例价）
 */
import type { Pool } from 'mysql2/promise'
import { ensureSchemaColumns } from './migrations-columns.js'
import { runSeedStage, SEED_USERS, MODEL_PRICE_SEEDS } from './migrations-seed.js'

export { SEED_USERS, MODEL_PRICE_SEEDS }

/** 迁移入口：建表（调用方已执行）后调用，全部幂等 */
export async function runMigrationsAndSeed(pool: Pool) {
  await ensureSchemaColumns(pool)
  await runSeedStage(pool)
}
