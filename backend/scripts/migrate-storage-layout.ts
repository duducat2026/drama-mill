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
 * 存储布局迁移脚本 — 平铺 `static/{分类}/{uuid}.ext` → 分层 `{分类}/{user_id}/{drama_id}/{uuid}.ext`
 *
 * 用法：cd backend && npx tsx scripts/migrate-storage-layout.ts [--dry-run] [--skip-orphans]
 *
 *   --dry-run       只计算并输出迁移清单/统计，不动文件不动库
 *   --skip-orphans  跳过孤儿文件归档（默认将无引用的平铺文件移入 data/static/_orphan/）
 *
 * 注意：
 * - 执行前须停写（pm2 stop）并备份数据库（mysqldump）；脚本幂等可重复执行
 * - 数据库只存相对路径，迁移同步改写全部存路径的列（含 sys_task.local_path，
 *   generation-refs.ts 的参考素材本地回退依赖它）
 * - 大表按 id 分段流式读取，不一次性全表加载
 *
 * 实现分层：state.ts（归属索引/路径映射/全局状态）· scan.ts（全表扫描）· files.ts（搬迁/归档/回写）
 */
import {
  buildOwnerIndexes,
  DRY_RUN,
  getStorageRoot,
  moves,
  SKIP_ORPHANS,
  updatesByTable,
} from './migrate-storage-layout/state.js'
import { scanTables } from './migrate-storage-layout/scan.js'
import { applyDbUpdates, archiveOrphans, moveFiles } from './migrate-storage-layout/files.js'

async function main() {
  console.log(`[migrate-storage-layout] ${DRY_RUN ? 'DRY-RUN 模式（不动文件不动库）' : '正式执行'} | storage root = ${getStorageRoot()}`)
  await buildOwnerIndexes()
  await scanTables()

  let updateRows = 0
  for (const [, { rows }] of updatesByTable) updateRows += rows.length
  console.log(`[scan] 待迁移路径 ${moves.size} 个，涉及 ${updateRows} 行数据库记录：`)
  for (const [tableKey, { rows }] of updatesByTable) console.log(`  - ${tableKey}: ${rows.length} 行`)
  const sample = [...moves.entries()].slice(0, 5)
  for (const [o, n] of sample) console.log(`  示例: ${o} → ${n}`)

  if (DRY_RUN) {
    if (!SKIP_ORPHANS) archiveOrphans()
    console.log('[dry-run] 结束，未做任何变更')
    process.exit(0)
  }

  await moveFiles()
  if (!SKIP_ORPHANS) archiveOrphans()
  await applyDbUpdates()
  console.log('[done] 迁移完成，请重启后端并抽查：列表缩略图 / 分镜视频 / 成片播放 / 参考素材回退')
  process.exit(0)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
