============================================================================
-- Drama Mill 数据库初始化脚本（生成物，请勿手改）
-- 来源: backend/src/db/mysql-schema.ts
-- 导出: backend/scripts/export-init-sql.ts
-- 时间: 2026-09-26T16:40:37.310Z
-- 说明: 应用启动自带幂等初始化，本脚本仅用于审核/预建表
============================================================================

SET NAMES utf8mb4;
----------------------------------------------------------------------------
-- 建表语句（共 27 张）
----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dramas (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    genre TEXT,
    style VARCHAR(64) DEFAULT '3d',
    aspect_ratio VARCHAR(16) DEFAULT '16:9',
    total_episodes INT DEFAULT 1,
    total_duration INT DEFAULT 0,
    status VARCHAR(64) NOT NULL DEFAULT 'draft',
    thumbnail TEXT,
    tags TEXT,
    metadata TEXT,
    user_id INT,
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    deleted_at VARCHAR(64),
    INDEX idx_dramas_user_id (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS episodes (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    drama_id INT NOT NULL,
    episode_number INT NOT NULL,
    title TEXT NOT NULL,
    content MEDIUMTEXT,
    script_content MEDIUMTEXT,
    description TEXT,
    duration INT DEFAULT 0,
    status VARCHAR(64) DEFAULT 'draft',
    video_url TEXT,
    thumbnail TEXT,
    image_config_id INT,
    video_config_id INT,
    resolution VARCHAR(16) DEFAULT '720p',
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    deleted_at VARCHAR(64),
    INDEX idx_episodes_drama_id (drama_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS characters (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    drama_id INT NOT NULL,
    name TEXT NOT NULL,
    role TEXT,
    description TEXT,
    appearance TEXT,
    styling TEXT,
    final_prompt TEXT,
    personality TEXT,
    image_url TEXT,
    reference_images TEXT,
    seed_value TEXT,
    sort_order INT,
    local_path TEXT,
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    deleted_at VARCHAR(64),
    INDEX idx_characters_drama_id (drama_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scenes (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    drama_id INT NOT NULL,
    episode_id INT,
    location TEXT NOT NULL,
    time VARCHAR(64) NOT NULL,
    prompt TEXT NOT NULL,
    lighting TEXT,
    final_prompt TEXT,
    storyboard_count INT DEFAULT 1,
    image_url TEXT,
    status VARCHAR(64) DEFAULT 'pending',
    local_path TEXT,
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    deleted_at VARCHAR(64),
    INDEX idx_scenes_drama_id (drama_id),
    INDEX idx_scenes_episode_id (episode_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storyboards (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    episode_id INT NOT NULL,
    scene_id INT,
    storyboard_number INT NOT NULL,
    title TEXT,
    location TEXT,
    time VARCHAR(64),
    shot_type TEXT,
    angle TEXT,
    movement TEXT,
    result TEXT,
    atmosphere TEXT,
    image_prompt TEXT,
    video_prompt TEXT,
    bgm_prompt TEXT,
    sound_effect TEXT,
    description TEXT,
    duration INT DEFAULT 0,
    composed_image TEXT,
    first_frame_image TEXT,
    last_frame_image TEXT,
    reference_images TEXT,
    video_url TEXT,
    video_model VARCHAR(64),
    subtitle_url TEXT,
    composed_video_url TEXT,
    status VARCHAR(64) DEFAULT 'pending',
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    deleted_at VARCHAR(64),
    INDEX idx_storyboards_episode_id (episode_id),
    INDEX idx_storyboards_created_id (created_at, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS episode_characters (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    episode_id INT NOT NULL,
    character_id INT NOT NULL,
    created_at VARCHAR(64) NOT NULL,
    INDEX idx_episode_characters_episode_id (episode_id),
    INDEX idx_episode_characters_character_id (character_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS episode_scenes (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    episode_id INT NOT NULL,
    scene_id INT NOT NULL,
    created_at VARCHAR(64) NOT NULL,
    INDEX idx_episode_scenes_episode_id (episode_id),
    INDEX idx_episode_scenes_scene_id (scene_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS episode_props (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    episode_id INT NOT NULL,
    prop_id INT NOT NULL,
    created_at VARCHAR(64) NOT NULL,
    INDEX idx_episode_props_episode_id (episode_id),
    INDEX idx_episode_props_prop_id (prop_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storyboard_characters (
    storyboard_id INT NOT NULL,
    character_id INT NOT NULL,
    PRIMARY KEY (storyboard_id, character_id),
    INDEX idx_storyboard_characters_character_id (character_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storyboard_props (
    storyboard_id INT NOT NULL,
    prop_id INT NOT NULL,
    PRIMARY KEY (storyboard_id, prop_id),
    INDEX idx_storyboard_props_prop_id (prop_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS novels (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    drama_id INT,
    title TEXT NOT NULL,
    file_name TEXT,
    content MEDIUMTEXT NOT NULL,
    char_count INT DEFAULT 0,
    chapter_count INT DEFAULT 0,
    split_status VARCHAR(16) NOT NULL DEFAULT 'uploaded',
    split_error TEXT,
    split_info TEXT,
    split_template_id INT,
    user_id INT,
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    deleted_at VARCHAR(64),
    INDEX idx_novels_drama_id (drama_id),
    INDEX idx_novels_user_id (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS novel_split_templates (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    value VARCHAR(64) NOT NULL,
    prompt TEXT NOT NULL,
    description TEXT,
    default_target_chars INT,
    split_mode VARCHAR(16) NOT NULL DEFAULT 'chars',
    default_paragraphs INT,
    sort_order INT DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    user_id INT,
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    UNIQUE KEY uk_novel_split_templates_value_user (value, user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_service_configs (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_service_providers (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS style_presets (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sys_task (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS video_merges (
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
    INDEX idx_video_merges_user_id (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sys_config (
    config_key VARCHAR(64) NOT NULL PRIMARY KEY,
    config_value TEXT,
    updated_at VARCHAR(64) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS props (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assets (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stage_timings (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS production_batches (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS production_batch_items (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS model_prices (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS usage_records (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

----------------------------------------------------------------------------
-- 种子数据（风格预设，INSERT 只补缺失行）
----------------------------------------------------------------------------
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '3D 漫剧', '3d', '3D CG animation style, game-engine quality render, semi-realistic stylized characters, refined facial features, detailed materials and textures, cinematic lighting, high detail', '游戏引擎级 3D 渲染，半写实角色，当前短剧主流的 3D 漫剧质感', 1, 1, NULL, '2026-09-26T16:40:37.308Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = '3d' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '日漫赛璐璐', 'anime', 'Japanese anime style, cel shading, clean crisp line art, vivid saturated colors, expressive character designs, detailed painted backgrounds', '日式赛璐璐动画风格', 2, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'anime' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '吉卜力手绘', 'ghibli', 'Studio Ghibli style, hand-drawn animation, soft watercolor painted backgrounds, warm nostalgic lighting, gentle natural palette, whimsical cozy atmosphere', '吉卜力手绘治愈风', 3, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'ghibli' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '水彩绘本', 'watercolor', 'watercolor illustration style, soft translucent washes, visible paper texture, delicate fluid brushwork, light airy atmosphere, hand-painted storybook feel', '水彩插画质感', 4, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'watercolor' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '美式漫画', 'comic', 'Western comic book style, bold black ink outlines, halftone dot shading, dynamic saturated colors, dramatic contrast lighting, flat graphic novel look', '美式漫画粗线条风格', 5, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'comic' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '真人写实Pro', 'real-pro', 'pro-grade photorealistic live-action film style, cinematic film still, ultra realistic skin texture, natural golden hour sunset lighting, high-end TV drama quality, 8K detail', '电影级真人写实，日落氛围人像', 6, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'real-pro' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '真人古装Pro', 'guzhuang-pro', 'pro-grade photorealistic Chinese period drama style, exquisite traditional hanfu with ornate golden headpiece, imperial palace interior, cinematic soft lighting, ultra-detailed period costumes', '电影级真人古装，华丽宫廷造型', 7, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'guzhuang-pro' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '真人仙侠Pro', 'xianxia-pro', 'pro-grade photorealistic Chinese xianxia drama style, ethereal immortal with long flowing hair and silver hairpiece, snowy mystical backdrop, cold cinematic lighting, fantasy cultivation atmosphere', '电影级真人仙侠，冷冽仙气', 8, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'xianxia-pro' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '欧美写实Pro', 'western-pro', 'photorealistic Western live-action film style, mature western character in tailored dark coat, modern city street backdrop, Hollywood cinematic color grading, realistic skin texture', '欧美真人电影质感，都市剧情氛围', 9, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'western-pro' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '真人写实', 'real', 'photorealistic live-action style, candid street photography, natural daylight, young woman waving on a bustling shopping street, realistic modern urban life', '自然真人街拍，现代都市', 10, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'real' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '真人古装', 'guzhuang', 'photorealistic Chinese period style, gentle classical beauty in soft pink hanfu with floral hair ornaments, dreamy soft-focus garden backdrop', '柔美真人古装，古典庭院', 11, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'guzhuang' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '真人仙侠', 'xianxia', 'photorealistic Chinese xianxia style, immortal in flowing white and blue robes standing before celestial palace above sea of clouds, ethereal fantasy atmosphere', '真人仙侠，云海仙宫', 12, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'xianxia' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '真人废土', 'real-wasteland', 'photorealistic post-apocalyptic wasteland style, gritty survivor with worn workwear and dirt-smudged face, dim cluttered workshop, dusty desaturated lighting', '真人末世废土，粗粝幸存者', 13, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'real-wasteland' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '真人年代感', 'real-period', 'photorealistic retro period drama style, nostalgic 1970s Chinese atmosphere, young woman with braided hair at vintage sewing machine, warm muted film grain', '真人怀旧年代剧质感', 14, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'real-period' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '2D国风动漫', 'guofeng-2d', '2D Chinese guofeng anime style, elegant young swordsman in green and white hanfu, clean line art with ink wash shading, classical plum blossom and scroll painting backdrop', '2D 国风线稿，古典东方美学', 15, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'guofeng-2d' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '3D国风动漫', 'guofeng-3d', '3D Chinese style animation render, refined CG girl in traditional red and gold hanfu, rich palace backdrop with lanterns and blossoms, semi-realistic stylized detail', '3D 国风 CG，华丽宫廷氛围', 16, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'guofeng-3d' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '动漫古言', 'anime-guyan', 'soft painterly anime style, ancient Chinese romance setting, girl in yellow hanfu on a swing among blooming flowers, gentle pastel palette, delicate elegant character design', '唯美古风动漫，柔情花园', 17, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'anime-guyan' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '动漫末世', 'anime-moshi', 'dark gritty anime style, post-apocalyptic male survivor holding a torch, industrial ruin backdrop, high contrast dramatic shading, worn leather gear', '暗黑末世动漫，火把与废墟', 18, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'anime-moshi' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '3D卡通', 'cartoon-3d', 'polished 3D cartoon style, stylized princess character in sparkling blue ball gown, smooth rounded forms, vibrant saturated colors, animated feature film quality', '3D 卡通电影质感，公主角', 19, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'cartoon-3d' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '逼真3D渲染', 'render-3d', 'ultra-realistic 3D render style, near-photoreal CG woman with transparent umbrella on rainy city street, detailed wet materials and cinematic reflections', '逼真 3D 渲染，雨天街景', 20, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'render-3d' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '科幻写实', 'scifi-real', 'sci-fi cinematic style, hooded hacker girl surrounded by neon holographic screens in a futuristic control room, cyberpunk blue-magenta lighting', '科幻赛博朋克，霓虹全息屏', 21, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'scifi-real' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '3D Q版', 'chibi-3d', 'cute 3D chibi character style, big-head small-body boy in blue hoodie waving at a bus stop, toy-like smooth render, bright cheerful colors', '3D Q版萌系，玩具质感', 22, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'chibi-3d' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '日系漫画', 'jp-manga', 'Japanese manga illustration style, delicate line art with soft watercolor tones, schoolgirl with flowing hair under cherry blossoms, expressive shojo manga look', '日系少女漫画，樱花氛围', 23, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'jp-manga' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '新时代日漫', 'jp-anime-modern', 'modern Japanese anime style, clean digital coloring, contemporary schoolgirl in pink cardigan on tree-lined street, soft natural lighting, refined character design', '新时代日漫，清新都市日常', 24, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'jp-anime-modern' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '2D童话', 'fairytale-2d', 'warm 2D storybook illustration style, girl reading a book by the window in a cozy room, soft warm palette, gentle hand-drawn picture book feel', '温暖手绘童话绘本风', 25, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'fairytale-2d' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '2D废土', 'wasteland-2d', 'gritty 2D comic style, post-apocalyptic desert survivor with goggles and head wrap, dusty earthy palette, rough textured brushwork', '2D 粗粝废土，荒漠幸存者', 26, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'wasteland-2d' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '水墨武侠', 'ink-wuxia', 'Chinese ink wash painting style, wuxia swordsman with oil-paper umbrella in misty mountains, minimalist black ink strokes, zen atmospheric negative space', '中式水墨山水，写意武侠', 27, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'ink-wuxia' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '熊猫头风格', 'panda-head', 'Chinese meme cartoon style, exaggerated panda-head warrior with hilarious facial expression, bold flat colors, humorous rough sketch lines', '熊猫头表情包风，幽默夸张', 28, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'panda-head' AND `user_id` IS NULL);
INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '2D Q版', 'chibi-2d', 'cute 2D chibi anime style, simple clean line art, school uniform girl on sunny city street, bright flat colors, lighthearted slice-of-life mood', '2D Q版萌系，清新日常', 29, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = 'chibi-2d' AND `user_id` IS NULL);
INSERT INTO `novel_split_templates` (`name`, `value`, `prompt`, `description`, `default_target_chars`, `split_mode`, `default_paragraphs`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '小说', 'novel', '这是一部叙事型小说。请按小说章节边界拆分，每集保留完整的剧情起伏；标题需体现本集核心冲突与悬念（如“退婚当日，她亮出真实身份”），概要用一句话点明本集看点，语言风格贴近网文短剧的强节奏叙事。', '通用网文/小说拆分：按章节归组，强悬念标题 + 看点概要', 15000, 'chars', NULL, 1, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `novel_split_templates` WHERE `value` = 'novel' AND `user_id` IS NULL);
INSERT INTO `novel_split_templates` (`name`, `value`, `prompt`, `description`, `default_target_chars`, `split_mode`, `default_paragraphs`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '诗词', 'poetry', '这是一部诗词作品集（诗/词/曲）。系统已按段落数量拆分（空行分隔的一段即一首/一组作品，每集固定段落数），请保持单首作品完整不要截断；标题使用作品首句或词牌名加主题（如“水调歌头·明月几时有”），概要说明作者、朝代与意境，语言雅致凝练。', '诗词曲赋拆分：按段落数归组（每集 20 段），标题雅致，注明作者与意境', 2000, 'paragraphs', 20, 2, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `novel_split_templates` WHERE `value` = 'poetry' AND `user_id` IS NULL);
INSERT INTO `novel_split_templates` (`name`, `value`, `prompt`, `description`, `default_target_chars`, `split_mode`, `default_paragraphs`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT '幽默笑话', 'humor', '这是一部幽默笑话/段子合集。系统已按段落数量拆分（空行分隔的一段即一则笑话，每集固定段落数），严禁把一个笑话拦腰截断；标题轻松搞笑带包袱感（如“老板画饼翻车现场”），概要提炼笑点但不剧透结尾，语气轻松活泼。', '笑话段子拆分：按段落数归组（每集 15 段），标题轻松带包袱', 3000, 'paragraphs', 15, 3, 1, NULL, '2026-09-26T16:40:37.309Z', '2026-09-26T16:40:37.309Z' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `novel_split_templates` WHERE `value` = 'humor' AND `user_id` IS NULL);
