/*
 * Drama Mill — 增量迁移：幂等列/索引工具 + 存量表结构升级
 */
import type { Pool } from 'mysql2/promise'

async function columnExists(pool: Pool, table: string, column: string): Promise<boolean> {
  const [rows] = await pool.query(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    [table, column],
  )
  return (rows as unknown[]).length > 0
}

async function ensureColumn(pool: Pool, table: string, column: string, ddl: string) {
  if (await columnExists(pool, table, column)) return
  await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`)
}

async function indexExists(pool: Pool, table: string, indexName: string): Promise<boolean> {
  const [rows] = await pool.query('SHOW INDEX FROM `' + table + '` WHERE Key_name = ?', [indexName])
  return (rows as unknown[]).length > 0
}

async function ensureIndex(pool: Pool, table: string, indexName: string, columns: string) {
  if (await indexExists(pool, table, indexName)) return
  await pool.query(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (${columns})`)
}

async function ensureUniqueIndex(pool: Pool, table: string, indexName: string, columns: string) {
  if (await indexExists(pool, table, indexName)) return
  await pool.query(`ALTER TABLE \`${table}\` ADD UNIQUE INDEX \`${indexName}\` (${columns})`)
}

async function dropIndex(pool: Pool, table: string, indexName: string) {
  if (!(await indexExists(pool, table, indexName))) return
  await pool.query(`ALTER TABLE \`${table}\` DROP INDEX \`${indexName}\``)
}

/** 列类型幂等升级：当前类型与目标不一致才 ALTER（如 TEXT → MEDIUMTEXT） */
async function ensureColumnType(pool: Pool, table: string, column: string, targetType: string) {
  const [rows] = await pool.query(
    'SELECT data_type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    [table, column],
  )
  const cur = (rows as { data_type?: string; DATA_TYPE?: string }[])[0]?.data_type
    ?? (rows as { DATA_TYPE?: string }[])[0]?.DATA_TYPE
  if (!cur || cur.toLowerCase() === targetType.toLowerCase()) return
  await pool.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${targetType}`)
}

/** 列允许 NULL 幂等升级：当前为 NOT NULL 才 ALTER（novels.drama_id 小说库模式放开） */
async function ensureColumnNullable(pool: Pool, table: string, column: string, ddl: string) {
  const [rows] = await pool.query(
    'SELECT is_nullable FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    [table, column],
  )
  const nullable = (rows as { is_nullable?: string; IS_NULLABLE?: string }[])[0]?.is_nullable
    ?? (rows as { IS_NULLABLE?: string }[])[0]?.IS_NULLABLE
  if (!nullable || nullable.toUpperCase() === 'YES') return
  await pool.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${ddl}`)
}

/** 存量表结构升级：补 user_id / 各类功能列与高频查询索引，全部幂等 */
export async function ensureSchemaColumns(pool: Pool) {
  // 1) 存量表补 user_id
  for (const table of ['dramas', 'ai_service_configs', 'sys_task', 'video_merges', 'assets']) {
    await ensureColumn(pool, table, 'user_id', 'user_id INT')
    await ensureIndex(pool, table, `idx_${table}_user_id`, 'user_id')
  }

  // 1.5) sys_task 补重试计数列（失败任务自动恢复按此限次）
  await ensureColumn(pool, 'sys_task', 'retry_count', 'retry_count INT NOT NULL DEFAULT 0')

  // 1.55) users 补存储配额覆盖列（NULL 沿用全局默认 STORAGE_QUOTA_GB）
  await ensureColumn(pool, 'users', 'storage_quota_bytes', 'storage_quota_bytes BIGINT NULL')

  // 1.551) users 补模型调用总开关列（用户侧可关，默认开启：存量用户行为不变）
  await ensureColumn(pool, 'users', 'ai_call_enabled', 'ai_call_enabled TINYINT(1) NOT NULL DEFAULT 1')

  // 1.552) users 补两个看门狗授权列（默认 0 = 不启动：自动重提/自动补图属后台悄悄花钱的行为，改为显式 opt-in）
  await ensureColumn(pool, 'users', 'retry_watchdog_enabled', 'retry_watchdog_enabled TINYINT(1) NOT NULL DEFAULT 0')
  await ensureColumn(pool, 'users', 'asset_watchdog_enabled', 'asset_watchdog_enabled TINYINT(1) NOT NULL DEFAULT 0')

  // 1.56) 风格预设多租户：补 user_id 列（NULL = 系统内置，全局共享）；
  // 旧全局唯一索引 uk_style_presets_value 放开为按租户隔离的 (value, user_id)，
  // 系统内置行（user_id NULL）不受唯一约束，查重由路由层完成
  await ensureColumn(pool, 'style_presets', 'user_id', 'user_id INT')
  await dropIndex(pool, 'style_presets', 'uk_style_presets_value')
  await ensureUniqueIndex(pool, 'style_presets', 'uk_style_presets_value_user', 'value, user_id')

  // 1.57) 小说管理：novels 补多租户/软删/拆分模版列，drama_id 放开允许 NULL（小说库模式）；
  // 批量生产批次补拆分提示词快照列（建批时自模版复制）
  await ensureColumn(pool, 'novels', 'user_id', 'user_id INT')
  await ensureColumn(pool, 'novels', 'deleted_at', 'deleted_at VARCHAR(64)')
  await ensureColumn(pool, 'novels', 'split_template_id', 'split_template_id INT')
  await ensureColumnNullable(pool, 'novels', 'drama_id', 'INT')
  await ensureIndex(pool, 'novels', 'idx_novels_user_id', 'user_id')
  await ensureColumn(pool, 'production_batches', 'split_prompt', 'split_prompt TEXT')

  // 1.58) 拆分模版支持按段落数归组（诗词/笑话短篇章）+ 批次两步走（先拆分后生产）；
  // 模版补 split_mode / default_paragraphs，批次补 mode / split_mode / paragraphs_per_episode 快照列；
  // 存量系统内置诗词/幽默模版升级为段落模式（仅命中未迁移行：split_mode 默认值且无段落数，幂等）
  await ensureColumn(pool, 'novel_split_templates', 'split_mode', "split_mode VARCHAR(16) NOT NULL DEFAULT 'chars'")
  await ensureColumn(pool, 'novel_split_templates', 'default_paragraphs', 'default_paragraphs INT')
  await ensureColumn(pool, 'production_batches', 'mode', "mode VARCHAR(16) NOT NULL DEFAULT 'full'")
  await ensureColumn(pool, 'production_batches', 'split_mode', "split_mode VARCHAR(16) NOT NULL DEFAULT 'chars'")
  await ensureColumn(pool, 'production_batches', 'paragraphs_per_episode', 'paragraphs_per_episode INT')
  await pool.query(`UPDATE novel_split_templates SET split_mode = 'paragraphs', default_paragraphs = CASE value WHEN 'poetry' THEN 20 WHEN 'humor' THEN 15 ELSE default_paragraphs END WHERE user_id IS NULL AND value IN ('poetry', 'humor') AND split_mode = 'chars' AND default_paragraphs IS NULL`)

  // 1.6) 高频查询列补索引：项目/集维度列表与 WHERE 下推依赖（幂等）
  await ensureIndex(pool, 'episodes', 'idx_episodes_drama_id', 'drama_id')
  await ensureIndex(pool, 'characters', 'idx_characters_drama_id', 'drama_id')
  await ensureIndex(pool, 'scenes', 'idx_scenes_drama_id', 'drama_id')
  await ensureIndex(pool, 'scenes', 'idx_scenes_episode_id', 'episode_id')
  await ensureIndex(pool, 'props', 'idx_props_drama_id', 'drama_id')
  await ensureIndex(pool, 'storyboards', 'idx_storyboards_episode_id', 'episode_id')
  await ensureIndex(pool, 'video_merges', 'idx_video_merges_episode_id', 'episode_id')

  // 1.7) sys_task 为全库最大表（只增不减）：编排轮询/看门狗/自动重试/管理面板的状态与时间窗口查询均依赖索引下推
  await ensureIndex(pool, 'sys_task', 'idx_sys_task_status', 'status')
  await ensureIndex(pool, 'sys_task', 'idx_sys_task_type_status', 'type, status')
  await ensureIndex(pool, 'sys_task', 'idx_sys_task_drama_id', 'drama_id')
  await ensureIndex(pool, 'sys_task', 'idx_sys_task_updated_at', 'updated_at')
  // 资产维度去重/看门狗按 character_id/scene_id/prop_id 查在途任务
  await ensureIndex(pool, 'sys_task', 'idx_sys_task_character_id', 'character_id')
  await ensureIndex(pool, 'sys_task', 'idx_sys_task_scene_id', 'scene_id')
  await ensureIndex(pool, 'sys_task', 'idx_sys_task_prop_id', 'prop_id')

  // 1.8) 集-资产关联表主键为自增 id，按 episode_id 查询无索引即全表扫；编排每步/看门狗高频命中
  await ensureIndex(pool, 'episode_characters', 'idx_episode_characters_episode_id', 'episode_id')
  await ensureIndex(pool, 'episode_scenes', 'idx_episode_scenes_episode_id', 'episode_id')
  await ensureIndex(pool, 'episode_props', 'idx_episode_props_episode_id', 'episode_id')

  // 1.9) 只增型明细表：成本聚合与审计分页的过滤下推依赖（updated_at/created_at 为 varchar ISO 串，字典序即时间序）
  await ensureIndex(pool, 'usage_records', 'idx_usage_records_drama_id', 'drama_id')
  await ensureIndex(pool, 'usage_records', 'idx_usage_records_user_id', 'user_id')
  await ensureIndex(pool, 'usage_records', 'idx_usage_records_created_at', 'created_at')
  await ensureIndex(pool, 'audit_logs', 'idx_audit_logs_created_at', 'created_at')

  // 1.95) 集正文/剧本扩容：分集按字数归组（单组可达 3 万汉字 ≈ 90KB+ UTF-8），TEXT 的 64KB 字节上限会击穿插入
  await ensureColumnType(pool, 'episodes', 'content', 'MEDIUMTEXT')
  await ensureColumnType(pool, 'episodes', 'script_content', 'MEDIUMTEXT')

  // 1.96) 分镜补视频模型列：视频任务完成回写 video_url 时同步落实际使用的模型（含多模型分流结果），免去联表 sys_task
  await ensureColumn(pool, 'storyboards', 'video_model', 'video_model VARCHAR(64)')

  // 1.97) 管理端大表列表深翻页排序索引：ORDER BY created_at DESC, id DESC 无对齐复合索引时退化为全匹配集 filesort（千万级致命）
  // sys_task(type) → (type, created_at)：最左前缀覆盖旧索引用途，替换后视频列表按时间序扫描免 filesort
  await ensureIndex(pool, 'sys_task', 'idx_sys_task_type_created', 'type, created_at')
  await dropIndex(pool, 'sys_task', 'idx_sys_task_type')
  // audit_logs(created_at) → (created_at, id)：对齐双列排序，存量老单列索引由最左前缀覆盖后删除
  await ensureIndex(pool, 'audit_logs', 'idx_audit_logs_created_id', 'created_at, id')
  await dropIndex(pool, 'audit_logs', 'idx_audit_logs_created_at')
  // storyboards 此前无任何时间索引：平台分镜列表按 created_at 排序全量 filesort
  await ensureIndex(pool, 'storyboards', 'idx_storyboards_created_id', 'created_at, id')
}
