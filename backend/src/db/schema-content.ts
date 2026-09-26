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
 * Drizzle schema — 内容侧：项目 / 剧集 / 角色 / 场景 / 道具 / 分镜 / 小说。
 */
import { mysqlTable, text, int, double, boolean, primaryKey, varchar, mediumtext, bigint } from 'drizzle-orm/mysql-core'

export const dramas = mysqlTable('dramas', {
  id: int('id').primaryKey().autoincrement(),
  title: text('title').notNull(),
  description: text('description'),
  genre: text('genre'),
  style: varchar('style', { length: 64 }).default('3d'),
  aspectRatio: varchar('aspect_ratio', { length: 16 }).default('16:9'),
  totalEpisodes: int('total_episodes').default(1),
  totalDuration: int('total_duration').default(0),
  status: varchar('status', { length: 64 }).notNull().default('draft'),
  thumbnail: text('thumbnail'),
  tags: text('tags'),
  metadata: text('metadata'),
  userId: int('user_id'),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
  updatedAt: varchar('updated_at', { length: 64 }).notNull(),
  deletedAt: varchar('deleted_at', { length: 64 }),
})

export const episodes = mysqlTable('episodes', {
  id: int('id').primaryKey().autoincrement(),
  dramaId: int('drama_id').notNull(),
  episodeNumber: int('episode_number').notNull(),
  title: text('title').notNull(),
  // MEDIUMTEXT：单集正文可达数万汉字（UTF-8 约 90KB+），TEXT 的 64KB 字节上限会击穿
  content: mediumtext('content'),
  scriptContent: mediumtext('script_content'),
  description: text('description'),
  duration: int('duration').default(0),
  status: varchar('status', { length: 64 }).default('draft'),
  videoUrl: text('video_url'),
  thumbnail: text('thumbnail'),
  imageConfigId: int('image_config_id'),
  videoConfigId: int('video_config_id'),
  resolution: varchar('resolution', { length: 16 }).default('720p'),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
  updatedAt: varchar('updated_at', { length: 64 }).notNull(),
  deletedAt: varchar('deleted_at', { length: 64 }),
})

export const characters = mysqlTable('characters', {
  id: int('id').primaryKey().autoincrement(),
  dramaId: int('drama_id').notNull(),
  name: text('name').notNull(),
  role: text('role'),
  description: text('description'),
  appearance: text('appearance'),
  styling: text('styling'),
  finalPrompt: text('final_prompt'),
  personality: text('personality'),
  imageUrl: text('image_url'),
  referenceImages: text('reference_images'),
  seedValue: text('seed_value'),
  sortOrder: int('sort_order'),
  localPath: text('local_path'),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
  updatedAt: varchar('updated_at', { length: 64 }).notNull(),
  deletedAt: varchar('deleted_at', { length: 64 }),
})

// Episode-Character many-to-many
export const episodeCharacters = mysqlTable('episode_characters', {
  id: int('id').primaryKey().autoincrement(),
  episodeId: int('episode_id').notNull(),
  characterId: int('character_id').notNull(),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
})

// Episode-Scene many-to-many
export const episodeScenes = mysqlTable('episode_scenes', {
  id: int('id').primaryKey().autoincrement(),
  episodeId: int('episode_id').notNull(),
  sceneId: int('scene_id').notNull(),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
})

// Episode-Prop many-to-many
export const episodeProps = mysqlTable('episode_props', {
  id: int('id').primaryKey().autoincrement(),
  episodeId: int('episode_id').notNull(),
  propId: int('prop_id').notNull(),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
})

export const scenes = mysqlTable('scenes', {
  id: int('id').primaryKey().autoincrement(),
  dramaId: int('drama_id').notNull(),
  episodeId: int('episode_id'),
  location: text('location').notNull(),
  time: varchar('time', { length: 64 }).notNull(),
  prompt: text('prompt').notNull(),
  lighting: text('lighting'),
  finalPrompt: text('final_prompt'),
  storyboardCount: int('storyboard_count').default(1),
  imageUrl: text('image_url'),
  status: varchar('status', { length: 64 }).default('pending'),
  localPath: text('local_path'),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
  updatedAt: varchar('updated_at', { length: 64 }).notNull(),
  deletedAt: varchar('deleted_at', { length: 64 }),
})

export const storyboards = mysqlTable('storyboards', {
  id: int('id').primaryKey().autoincrement(),
  episodeId: int('episode_id').notNull(),
  sceneId: int('scene_id'),
  storyboardNumber: int('storyboard_number').notNull(),
  title: text('title'),
  location: text('location'),
  time: varchar('time', { length: 64 }),
  shotType: text('shot_type'),
  angle: text('angle'),
  movement: text('movement'),
  result: text('result'),
  atmosphere: text('atmosphere'),
  imagePrompt: text('image_prompt'),
  videoPrompt: text('video_prompt'),
  bgmPrompt: text('bgm_prompt'),
  soundEffect: text('sound_effect'),
  description: text('description'),
  duration: int('duration').default(0),
  composedImage: text('composed_image'),
  firstFrameImage: text('first_frame_image'),
  lastFrameImage: text('last_frame_image'),
  referenceImages: text('reference_images'),
  videoUrl: text('video_url'),
  videoModel: varchar('video_model', { length: 64 }),
  subtitleUrl: text('subtitle_url'),
  composedVideoUrl: text('composed_video_url'),
  status: varchar('status', { length: 64 }).default('pending'),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
  updatedAt: varchar('updated_at', { length: 64 }).notNull(),
  deletedAt: varchar('deleted_at', { length: 64 }),
})

export const storyboardCharacters = mysqlTable('storyboard_characters', {
  storyboardId: int('storyboard_id').notNull(),
  characterId: int('character_id').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.storyboardId, table.characterId] }),
}))

export const storyboardProps = mysqlTable('storyboard_props', {
  storyboardId: int('storyboard_id').notNull(),
  propId: int('prop_id').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.storyboardId, table.propId] }),
}))

export const novels = mysqlTable('novels', {
  id: int('id').primaryKey().autoincrement(),
  // 小说库模式下可先入库不建项目（NULL = 尚未生成项目），创建项目后回填
  dramaId: int('drama_id'),
  title: text('title').notNull(),
  fileName: text('file_name'),
  content: mediumtext('content').notNull(),
  charCount: int('char_count').default(0),
  chapterCount: int('chapter_count').default(0),
  splitStatus: varchar('split_status', { length: 16 }).notNull().default('uploaded'), // uploaded | splitting | split | failed
  splitError: text('split_error'),
  splitInfo: text('split_info'), // JSON: 目标字数/每集章节范围等拆分元信息
  splitTemplateId: int('split_template_id'), // 最近一次拆分使用的提示词模版（快照参考，模版删除不影响历史记录）
  userId: int('user_id'),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
  updatedAt: varchar('updated_at', { length: 64 }).notNull(),
  deletedAt: varchar('deleted_at', { length: 64 }),
})

// 小说拆分提示词模版：user_id NULL = 系统内置（全局共享，仅 admin 可改），否则为用户私有
export const novelSplitTemplates = mysqlTable('novel_split_templates', {
  id: int('id').primaryKey().autoincrement(),
  name: varchar('name', { length: 64 }).notNull(),
  value: varchar('value', { length: 64 }).notNull(),
  prompt: text('prompt').notNull(),
  description: text('description'),
  // 模版默认每集目标字数（选择模版时预填，用户仍可覆盖）
  defaultTargetChars: int('default_target_chars'),
  // 拆分方式：chars 按目标字数归组；paragraphs 按段落数归组（诗词/笑话等短篇章推荐）
  splitMode: varchar('split_mode', { length: 16 }).notNull().default('chars'),
  // paragraphs 模式下每集段落数（一段 = 空行分隔的一块，诗词一首/笑话一则通常即一段）
  defaultParagraphs: int('default_paragraphs'),
  sortOrder: int('sort_order').default(0),
  isActive: boolean('is_active').default(true),
  userId: int('user_id'),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
  updatedAt: varchar('updated_at', { length: 64 }).notNull(),
  // 注意: 此表无 deleted_at（硬删除），(value, user_id) 唯一索引见 DDL
})
