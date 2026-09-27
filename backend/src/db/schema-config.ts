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
 * Drizzle schema — 平台侧：AI 配置 / 任务 / 用户 / 计费 / 批量生产。
 */
import { mysqlTable, text, int, double, boolean, primaryKey, varchar, mediumtext, bigint } from 'drizzle-orm/mysql-core'


export const aiServiceConfigs = mysqlTable('ai_service_configs', {
  id: int('id').primaryKey().autoincrement(),
  serviceType: varchar('service_type', { length: 64 }).notNull(),
  provider: varchar('provider', { length: 64 }),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKey: text('api_key').notNull(),
  model: text('model'),
  endpoint: text('endpoint'),
  queryEndpoint: text('query_endpoint'),
  priority: int('priority').default(0),
  isDefault: boolean('is_default').default(false),
  isActive: boolean('is_active').default(true),
  settings: text('settings'),
  userId: int('user_id'),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
  updatedAt: varchar('updated_at', { length: 64 }).notNull(),
  // 注意: 此表无 deleted_at
})

export const aiServiceProviders = mysqlTable('ai_service_providers', {
  id: int('id').primaryKey().autoincrement(),
  name: text('name').notNull(),
  displayName: text('display_name'),
  serviceType: varchar('service_type', { length: 64 }).notNull(),
  provider: varchar('provider', { length: 64 }).notNull(),
  defaultUrl: text('default_url'),
  presetModels: text('preset_models'),
  description: text('description'),
  isActive: boolean('is_active').default(true),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
  updatedAt: varchar('updated_at', { length: 64 }).notNull(),
})

export const stylePresets = mysqlTable('style_presets', {
  id: int('id').primaryKey().autoincrement(),
  name: varchar('name', { length: 64 }).notNull(),
  value: varchar('value', { length: 64 }).notNull(),
  prompt: text('prompt').notNull(),
  description: text('description'),
  sortOrder: int('sort_order').default(0),
  isActive: boolean('is_active').default(true),
  // 多租户：NULL = 系统内置（全局共享，仅 admin 可改），否则为该用户的私有风格
  userId: int('user_id'),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
  updatedAt: varchar('updated_at', { length: 64 }).notNull(),
  // 注意: 此表无 deleted_at（硬删除），(value, user_id) 唯一索引见 DDL；
  // 系统内置行（user_id NULL）不受该索引约束，由路由层查重兜底
})

// 统一生成任务表：图片/视频生成共用，type 区分，生成参数存 params(JSON)
export const sysTask = mysqlTable('sys_task', {
  id: int('id').primaryKey().autoincrement(),
  type: varchar('type', { length: 16 }).notNull(), // image | video
  storyboardId: int('storyboard_id'),
  dramaId: int('drama_id'),
  sceneId: int('scene_id'),
  characterId: int('character_id'),
  propId: int('prop_id'),
  provider: varchar('provider', { length: 64 }),
  prompt: text('prompt'),
  model: text('model'),
  // image: {size, frameType, referenceImages[]}
  // video: {referenceMode, referenceImageUrls[], referenceVideoUrls[], referenceAudioUrls[], generateAudio, duration, aspectRatio}
  params: text('params'),
  taskId: text('task_id'),
  resultUrl: text('result_url'),
  localPath: text('local_path'),
  status: varchar('status', { length: 64 }).default('processing'),
  errorMsg: text('error_msg'),
  // 重试计数：自动恢复重提时递增（达上限停止自动重提），手动重试重置为 0 重新计次
  retryCount: int('retry_count').default(0),
  userId: int('user_id'),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
  updatedAt: varchar('updated_at', { length: 64 }).notNull(),
  completedAt: varchar('completed_at', { length: 64 }),
})

// 运行时动态配置键值表：管理后台可在线修改的运行参数（如失败任务自动重提上限），无需重启即时生效
export const sysConfig = mysqlTable('sys_config', {
  configKey: varchar('config_key', { length: 64 }).primaryKey(),
  configValue: text('config_value'),
  updatedAt: varchar('updated_at', { length: 64 }).notNull(),
})

export const videoMerges = mysqlTable('video_merges', {
  id: int('id').primaryKey().autoincrement(),
  episodeId: int('episode_id'),
  dramaId: int('drama_id'),
  title: text('title'),
  provider: varchar('provider', { length: 64 }),
  model: text('model'),
  status: varchar('status', { length: 64 }).default('pending'),
  scenes: text('scenes'), // JSON
  mergedUrl: text('merged_url'),
  duration: int('duration'),
  taskId: text('task_id'),
  errorMsg: text('error_msg'),
  userId: int('user_id'),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
  completedAt: varchar('completed_at', { length: 64 }),
  deletedAt: varchar('deleted_at', { length: 64 }),
})

export const props = mysqlTable('props', {
  id: int('id').primaryKey().autoincrement(),
  dramaId: int('drama_id').notNull(),
  name: text('name').notNull(),
  type: text('type'),
  description: text('description'),
  prompt: text('prompt'),
  finalPrompt: text('final_prompt'),
  imageUrl: text('image_url'),
  referenceImages: text('reference_images'),
  localPath: text('local_path'),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
  updatedAt: varchar('updated_at', { length: 64 }).notNull(),
  deletedAt: varchar('deleted_at', { length: 64 }),
})

export const assets = mysqlTable('assets', {
  id: int('id').primaryKey().autoincrement(),
  dramaId: int('drama_id'),
  episodeId: int('episode_id'),
  storyboardId: int('storyboard_id'),
  storyboardNum: int('storyboard_num'),
  name: text('name'),
  description: text('description'),
  type: text('type'),
  category: text('category'),
  url: text('url'),
  thumbnailUrl: text('thumbnail_url'),
  localPath: text('local_path'),
  fileSize: int('file_size'),
  mimeType: text('mime_type'),
  width: int('width'),
  height: int('height'),
  duration: int('duration'),
  format: text('format'),
  imageGenId: int('image_gen_id'),
  videoGenId: int('video_gen_id'),
  isFavorite: boolean('is_favorite').default(false),
  viewCount: int('view_count').default(0),
  userId: int('user_id'),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
  updatedAt: varchar('updated_at', { length: 64 }).notNull(),
  deletedAt: varchar('deleted_at', { length: 64 }),
})

// ─── 多租户与平台管理 ───────────────────────────────
export const users = mysqlTable('users', {
  id: int('id').primaryKey().autoincrement(),
  username: varchar('username', { length: 64 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role: varchar('role', { length: 16 }).notNull().default('user'),
  status: varchar('status', { length: 16 }).notNull().default('active'),
  nickname: varchar('nickname', { length: 128 }),
  // 存储配额覆盖值（字节）：NULL/0 沿用全局默认（STORAGE_QUOTA_GB）
  storageQuotaBytes: bigint('storage_quota_bytes', { mode: 'number' }),
  // 模型调用总开关（用户侧）：0 = 关闭该用户全部 AI 调用，新提交一律拦截
  aiCallEnabled: boolean('ai_call_enabled').default(true),
  // 看门狗用户侧授权（默认 0 = 不启动）：未开启的用户不参与自动重提/自动补图，避免后台悄悄产生费用
  retryWatchdogEnabled: boolean('retry_watchdog_enabled').default(false),
  assetWatchdogEnabled: boolean('asset_watchdog_enabled').default(false),
  lastLoginAt: varchar('last_login_at', { length: 64 }),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
  updatedAt: varchar('updated_at', { length: 64 }).notNull(),
})

export const auditLogs = mysqlTable('audit_logs', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id'),
  username: varchar('username', { length: 64 }),
  role: varchar('role', { length: 16 }),
  method: varchar('method', { length: 16 }).notNull(),
  path: varchar('path', { length: 512 }).notNull(),
  action: varchar('action', { length: 255 }),
  detail: text('detail'),
  ip: varchar('ip', { length: 64 }),
  status: int('status'),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
})

export const stageTimings = mysqlTable('stage_timings', {
  id: int('id').primaryKey().autoincrement(),
  episodeId: int('episode_id'),
  dramaId: int('drama_id'),
  stage: varchar('stage', { length: 64 }).notNull(),
  startedAt: varchar('started_at', { length: 64 }).notNull(),
  finishedAt: varchar('finished_at', { length: 64 }),
  durationMs: int('duration_ms'),
  status: varchar('status', { length: 32 }).default('done'),
  meta: text('meta'),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
})

// AI 成本刊例价：价格单位均为 CNY（token 类为 元/百万Token，image 为 元/张，video_second 为 元/秒）
export const modelPrices = mysqlTable('model_prices', {
  id: int('id').primaryKey().autoincrement(),
  provider: varchar('provider', { length: 64 }).notNull(),
  model: varchar('model', { length: 128 }).notNull(),
  billingType: varchar('billing_type', { length: 32 }).notNull(),
  inputPrice: double('input_price').default(0),
  outputPrice: double('output_price').default(0),
  unitPrice: double('unit_price').default(0),
  currency: varchar('currency', { length: 16 }).default('CNY'),
  source: varchar('source', { length: 512 }),
  updatedAt: varchar('updated_at', { length: 64 }).notNull(),
})

export const usageRecords = mysqlTable('usage_records', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id'),
  dramaId: int('drama_id'),
  episodeId: int('episode_id'),
  configId: int('config_id'),
  serviceType: varchar('service_type', { length: 16 }).notNull(),
  provider: varchar('provider', { length: 64 }),
  model: varchar('model', { length: 128 }),
  inputTokens: int('input_tokens'),
  outputTokens: int('output_tokens'),
  imageCount: int('image_count'),
  videoSeconds: double('video_seconds'),
  cost: double('cost').default(0),
  priceMissing: boolean('price_missing').default(false),
  detail: text('detail'),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
})

export const productionBatches = mysqlTable('production_batches', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id').notNull(),
  status: varchar('status', { length: 32 }).notNull().default('pending'),
  targetChars: int('target_chars'),
  // 拆分提示词快照（建批时自模版复制，模版后续修改/删除不影响在途批次）
  splitPrompt: text('split_prompt'),
  // 两步走：full = 拆分后自动生产；split_only = 仅拆分，拆分完成后由用户确认再启动生产（/:id/produce 将 mode 改回 full）
  mode: varchar('mode', { length: 16 }).notNull().default('full'),
  // 拆分方式快照（建批时自模版复制）：chars 按字数归组 / paragraphs 按段落数归组；
  // paragraphs 模式下 paragraphs_per_episode 为每集段落数，字数模式下 target_chars 生效
  splitMode: varchar('split_mode', { length: 16 }).notNull().default('chars'),
  paragraphsPerEpisode: int('paragraphs_per_episode'),
  error: text('error'),
  startedAt: varchar('started_at', { length: 64 }),
  finishedAt: varchar('finished_at', { length: 64 }),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
  updatedAt: varchar('updated_at', { length: 64 }).notNull(),
  deletedAt: varchar('deleted_at', { length: 64 }),
})

export const productionBatchItems = mysqlTable('production_batch_items', {
  id: int('id').primaryKey().autoincrement(),
  batchId: int('batch_id').notNull(),
  seq: int('seq').notNull(),
  novelId: int('novel_id').notNull(),
  dramaId: int('drama_id').notNull(),
  status: varchar('status', { length: 32 }).notNull().default('pending'),
  error: text('error'),
  startedAt: varchar('started_at', { length: 64 }),
  finishedAt: varchar('finished_at', { length: 64 }),
})
