/*
 * Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
 * Copyright (C) 2026 Drama Mill <52859273@qq.com>
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

/**
 * 模型目录表 — 原外部 model_list 库的 models / prices 收编进主库的本地副本。
 * 运行时业务（admin 目录检索、刊例价导入）只访问本模块两张表；
 * model_list 仅允许部署期迁移脚本 scripts/migrate-model-catalog.ts 一次性读取。
 * 列集合与原检索投影一致（raw_json / price_raw / inference_metadata_raw 等大字段不带入）。
 */
import { bigint, boolean, double, index, int, mysqlTable, text, varchar } from 'drizzle-orm/mysql-core'

// 目录模型清单：id 保留 model_list.models 原值（迁移按 id upsert，幂等可重跑）
export const modelCatalogModels = mysqlTable('model_catalog_models', {
  id: int('id').primaryKey(),
  name: varchar('name', { length: 256 }),
  modelId: varchar('model_id', { length: 256 }),
  provider: varchar('provider', { length: 256 }),
  inferenceProvider: varchar('inference_provider', { length: 256 }),
  source: varchar('source', { length: 32 }),
  sourceUrl: varchar('source_url', { length: 512 }),
  contextWindow: bigint('context_window', { mode: 'number' }),
  maxInputTokens: bigint('max_input_tokens', { mode: 'number' }),
  maxOutputTokens: bigint('max_output_tokens', { mode: 'number' }),
  requestModality: text('request_modality'),
  responseModality: text('response_modality'),
  features: text('features'),
  description: text('description'),
  publishedTime: varchar('published_time', { length: 64 }),
  offlineTime: varchar('offline_time', { length: 64 }),
  isOffline: boolean('is_offline').default(false),
  extractedAt: varchar('extracted_at', { length: 32 }),
}, (t) => [
  index('idx_mcm_model_id').on(t.modelId),
  index('idx_mcm_provider').on(t.provider),
  index('idx_mcm_source').on(t.source),
])

// 目录价格明细：一模型多档价格；price 维持源表字符串原值，cap_zh 为中文档位名
export const modelCatalogPrices = mysqlTable('model_catalog_prices', {
  id: int('id').primaryKey(),
  modelName: varchar('model_name', { length: 256 }),
  modelId: varchar('model_id', { length: 256 }),
  provider: varchar('provider', { length: 256 }),
  inferenceProvider: varchar('inference_provider', { length: 256 }),
  capZh: text('cap_zh'),
  rangeName: varchar('range_name', { length: 256 }),
  priceName: varchar('price_name', { length: 256 }),
  priceType: varchar('price_type', { length: 64 }),
  price: varchar('price', { length: 64 }),
  priceUnit: varchar('price_unit', { length: 64 }),
  timeBand: varchar('time_band', { length: 64 }),
  currency: varchar('currency', { length: 16 }),
  unitPriceCny: double('unit_price_cny'),
  unitCny: varchar('unit_cny', { length: 64 }),
  billingMode: varchar('billing_mode', { length: 32 }),
  spec: varchar('spec', { length: 256 }),
  priceKind: varchar('price_kind', { length: 64 }),
  source: varchar('source', { length: 32 }),
  sourceUrl: varchar('source_url', { length: 512 }),
  isOffline: boolean('is_offline').default(false),
  extractedAt: varchar('extracted_at', { length: 32 }),
}, (t) => [
  index('idx_mcp_model_id').on(t.modelId),
  index('idx_mcp_provider').on(t.provider),
  index('idx_mcp_source').on(t.source),
])
