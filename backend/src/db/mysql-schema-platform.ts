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
 * MySQL DDL — 平台侧建表语句（ai_service_* / style_presets / sys_task / sys_config /
 * video_merges / props / assets / users / audit_logs / stage_timings /
 * production_batches* / model_prices / usage_records）。
 */
export const mysqlSchemaPlatformStatements: string[] = [
  `CREATE TABLE IF NOT EXISTS ai_service_configs (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    service_type VARCHAR(64) NOT NULL,
    provider VARCHAR(64),
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT,
    endpoint TEXT,
    query_endpoint TEXT,
    priority INT DEFAULT 0,
    is_default TINYINT(1) DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    settings TEXT,
    user_id INT,
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    INDEX idx_ai_service_configs_user_id (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS ai_service_providers (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT,
    service_type VARCHAR(64) NOT NULL,
    provider VARCHAR(64) NOT NULL,
    default_url TEXT,
    preset_models TEXT,
    description TEXT,
    is_active TINYINT(1) DEFAULT 1,
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS style_presets (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    value VARCHAR(64) NOT NULL,
    prompt TEXT NOT NULL,
    description TEXT,
    sort_order INT DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    user_id INT,
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    UNIQUE KEY uk_style_presets_value_user (value, user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS sys_task (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    type VARCHAR(16) NOT NULL,
    storyboard_id INT,
    drama_id INT,
    scene_id INT,
    character_id INT,
    prop_id INT,
    provider VARCHAR(64),
    prompt TEXT,
    model TEXT,
    params TEXT,
    task_id TEXT,
    result_url TEXT,
    local_path TEXT,
    status VARCHAR(64) DEFAULT 'processing',
    error_msg TEXT,
    retry_count INT NOT NULL DEFAULT 0,
    user_id INT,
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    completed_at VARCHAR(64),
    INDEX idx_sys_task_type_created (type, created_at),
    INDEX idx_sys_task_drama_id (drama_id),
    INDEX idx_sys_task_storyboard_id (storyboard_id),
    INDEX idx_sys_task_scene_id (scene_id),
    INDEX idx_sys_task_character_id (character_id),
    INDEX idx_sys_task_prop_id (prop_id),
    INDEX idx_sys_task_user_id (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS video_merges (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    episode_id INT,
    drama_id INT,
    title TEXT,
    provider VARCHAR(64) NOT NULL,
    model TEXT NOT NULL,
    status VARCHAR(64) DEFAULT 'pending',
    scenes TEXT,
    merged_url TEXT,
    duration INT,
    task_id TEXT,
    error_msg TEXT,
    user_id INT,
    created_at VARCHAR(64) NOT NULL,
    completed_at VARCHAR(64),
    deleted_at VARCHAR(64),
    INDEX idx_video_merges_episode_id (episode_id),
    INDEX idx_video_merges_user_id (user_id),
    INDEX idx_video_merges_created_id (created_at, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS sys_config (
    config_key VARCHAR(64) NOT NULL PRIMARY KEY,
    config_value TEXT,
    updated_at VARCHAR(64) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS props (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    drama_id INT NOT NULL,
    name TEXT NOT NULL,
    type TEXT,
    description TEXT,
    prompt TEXT,
    final_prompt TEXT,
    image_url TEXT,
    reference_images TEXT,
    local_path TEXT,
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    deleted_at VARCHAR(64),
    INDEX idx_props_drama_id (drama_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS assets (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    drama_id INT,
    episode_id INT,
    storyboard_id INT,
    storyboard_num INT,
    name TEXT,
    description TEXT,
    type TEXT,
    category TEXT,
    url TEXT,
    thumbnail_url TEXT,
    local_path TEXT,
    file_size INT,
    mime_type TEXT,
    width INT,
    height INT,
    duration INT,
    format TEXT,
    image_gen_id INT,
    video_gen_id INT,
    is_favorite TINYINT(1) DEFAULT 0,
    view_count INT DEFAULT 0,
    user_id INT,
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    deleted_at VARCHAR(64),
    INDEX idx_assets_user_id (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ─── 多租户与平台管理 ───────────────────────────────
  `CREATE TABLE IF NOT EXISTS users (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(16) NOT NULL DEFAULT 'user',
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    nickname VARCHAR(128),
    last_login_at VARCHAR(64),
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    UNIQUE KEY uk_users_username (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    username VARCHAR(64),
    role VARCHAR(16),
    method VARCHAR(16) NOT NULL,
    path VARCHAR(512) NOT NULL,
    action VARCHAR(255),
    detail TEXT,
    ip VARCHAR(64),
    status INT,
    created_at VARCHAR(64) NOT NULL,
    INDEX idx_audit_logs_user_id (user_id),
    INDEX idx_audit_logs_created_id (created_at, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS stage_timings (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    episode_id INT,
    drama_id INT,
    stage VARCHAR(64) NOT NULL,
    started_at VARCHAR(64) NOT NULL,
    finished_at VARCHAR(64),
    duration_ms INT,
    status VARCHAR(32) DEFAULT 'done',
    meta TEXT,
    created_at VARCHAR(64) NOT NULL,
    INDEX idx_stage_timings_episode_id (episode_id),
    INDEX idx_stage_timings_drama_id (drama_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // 批量生产编排：一次上传多部小说，按顺序逐部完成分集与视频生产（持久化，重启可续跑）
  `CREATE TABLE IF NOT EXISTS production_batches (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    target_chars INT,
    split_prompt TEXT,
    mode VARCHAR(16) NOT NULL DEFAULT 'full',
    split_mode VARCHAR(16) NOT NULL DEFAULT 'chars',
    paragraphs_per_episode INT,
    error TEXT,
    started_at VARCHAR(64),
    finished_at VARCHAR(64),
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    deleted_at VARCHAR(64),
    INDEX idx_production_batches_user_id (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS production_batch_items (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    batch_id INT NOT NULL,
    seq INT NOT NULL,
    novel_id INT NOT NULL,
    drama_id INT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    error TEXT,
    started_at VARCHAR(64),
    finished_at VARCHAR(64),
    INDEX idx_batch_items_batch_id (batch_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // AI 成本刊例价：provider+model 唯一；价格单位均为 CNY（元）
  `CREATE TABLE IF NOT EXISTS model_prices (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    provider VARCHAR(64) NOT NULL,
    model VARCHAR(128) NOT NULL,
    billing_type VARCHAR(32) NOT NULL,
    input_price DOUBLE DEFAULT 0,
    output_price DOUBLE DEFAULT 0,
    unit_price DOUBLE DEFAULT 0,
    currency VARCHAR(16) DEFAULT 'CNY',
    source VARCHAR(512),
    updated_at VARCHAR(64) NOT NULL,
    UNIQUE KEY uk_model_prices_provider_model (provider, model)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // 用户级模型价：从平台刊例价导入或自定义；计价按 user_id+model 优先于 model_prices
  `CREATE TABLE IF NOT EXISTS user_model_prices (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    provider VARCHAR(64) NOT NULL,
    model VARCHAR(128) NOT NULL,
    billing_type VARCHAR(32) NOT NULL,
    input_price DOUBLE DEFAULT 0,
    output_price DOUBLE DEFAULT 0,
    unit_price DOUBLE DEFAULT 0,
    currency VARCHAR(16) DEFAULT 'CNY',
    source VARCHAR(32) DEFAULT 'manual',
    updated_at VARCHAR(64) NOT NULL,
    UNIQUE KEY uniq_ump_user_model (user_id, model),
    INDEX idx_ump_user_id (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // 模型目录·模型清单：原外部 model_list.models 收编进主库（id 保留原值，迁移脚本按 id upsert）
  `CREATE TABLE IF NOT EXISTS model_catalog_models (
    id INT NOT NULL PRIMARY KEY,
    name VARCHAR(256),
    model_id VARCHAR(256),
    provider VARCHAR(256),
    inference_provider VARCHAR(256),
    source VARCHAR(32),
    source_url VARCHAR(512),
    context_window BIGINT,
    max_input_tokens BIGINT,
    max_output_tokens BIGINT,
    request_modality TEXT,
    response_modality TEXT,
    features TEXT,
    description TEXT,
    published_time VARCHAR(64),
    offline_time VARCHAR(64),
    is_offline TINYINT(1) DEFAULT 0,
    extracted_at VARCHAR(32),
    INDEX idx_mcm_model_id (model_id),
    INDEX idx_mcm_provider (provider),
    INDEX idx_mcm_source (source)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // 模型目录·价格明细：原外部 model_list.prices 收编进主库（price 维持字符串原值）
  `CREATE TABLE IF NOT EXISTS model_catalog_prices (
    id INT NOT NULL PRIMARY KEY,
    model_name VARCHAR(256),
    model_id VARCHAR(256),
    provider VARCHAR(256),
    inference_provider VARCHAR(256),
    cap_zh TEXT,
    range_name VARCHAR(256),
    price_name VARCHAR(256),
    price_type VARCHAR(64),
    price VARCHAR(64),
    price_unit VARCHAR(64),
    time_band VARCHAR(64),
    currency VARCHAR(16),
    unit_price_cny DOUBLE,
    unit_cny VARCHAR(64),
    billing_mode VARCHAR(32),
    spec VARCHAR(256),
    price_kind VARCHAR(64),
    source VARCHAR(32),
    source_url VARCHAR(512),
    is_offline TINYINT(1) DEFAULT 0,
    extracted_at VARCHAR(32),
    INDEX idx_mcp_model_id (model_id),
    INDEX idx_mcp_provider (provider),
    INDEX idx_mcp_source (source)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // AI 用量与成本明细：每次模型调用落一条（文本按 token，图片按张，视频按秒）
  `CREATE TABLE IF NOT EXISTS usage_records (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    drama_id INT,
    episode_id INT,
    config_id INT,
    service_type VARCHAR(16) NOT NULL,
    provider VARCHAR(64),
    model VARCHAR(128),
    input_tokens INT,
    output_tokens INT,
    image_count INT,
    video_seconds DOUBLE,
    cost DOUBLE DEFAULT 0,
    price_missing TINYINT(1) DEFAULT 0,
    detail TEXT,
    created_at VARCHAR(64) NOT NULL,
    INDEX idx_usage_records_user_id (user_id),
    INDEX idx_usage_records_drama_id (drama_id),
    INDEX idx_usage_records_episode_id (episode_id),
    INDEX idx_usage_records_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
]
