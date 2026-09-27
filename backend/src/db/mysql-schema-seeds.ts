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
 * MySQL 数据种子：风格预设 & 小说拆分模版（幂等 INSERT ... WHERE NOT EXISTS）。
 */

/**
 * 风格预设种子数据 — value 存入 dramas.style，prompt 注入生图提示词
 * 种子不写 user_id（NULL = 系统内置，全局共享，仅 admin 可改）
 */
export const stylePresetSeeds = [
  { name: '3D 漫剧', value: '3d', sortOrder: 1, prompt: '3D CG animation style, game-engine quality render, semi-realistic stylized characters, refined facial features, detailed materials and textures, cinematic lighting, high detail', description: '游戏引擎级 3D 渲染，半写实角色，当前短剧主流的 3D 漫剧质感' },
  { name: '日漫赛璐璐', value: 'anime', sortOrder: 2, prompt: 'Japanese anime style, cel shading, clean crisp line art, vivid saturated colors, expressive character designs, detailed painted backgrounds', description: '日式赛璐璐动画风格' },
  { name: '吉卜力手绘', value: 'ghibli', sortOrder: 3, prompt: 'Studio Ghibli style, hand-drawn animation, soft watercolor painted backgrounds, warm nostalgic lighting, gentle natural palette, whimsical cozy atmosphere', description: '吉卜力手绘治愈风' },
  { name: '水彩绘本', value: 'watercolor', sortOrder: 4, prompt: 'watercolor illustration style, soft translucent washes, visible paper texture, delicate fluid brushwork, light airy atmosphere, hand-painted storybook feel', description: '水彩插画质感' },
  { name: '美式漫画', value: 'comic', sortOrder: 5, prompt: 'Western comic book style, bold black ink outlines, halftone dot shading, dynamic saturated colors, dramatic contrast lighting, flat graphic novel look', description: '美式漫画粗线条风格' },
  { name: '真人写实Pro', value: 'real-pro', sortOrder: 6, prompt: 'pro-grade photorealistic live-action film style, cinematic film still, ultra realistic skin texture, natural golden hour sunset lighting, high-end TV drama quality, 8K detail', description: '电影级真人写实，日落氛围人像' },
  { name: '真人古装Pro', value: 'guzhuang-pro', sortOrder: 7, prompt: 'pro-grade photorealistic Chinese period drama style, exquisite traditional hanfu with ornate golden headpiece, imperial palace interior, cinematic soft lighting, ultra-detailed period costumes', description: '电影级真人古装，华丽宫廷造型' },
  { name: '真人仙侠Pro', value: 'xianxia-pro', sortOrder: 8, prompt: 'pro-grade photorealistic Chinese xianxia drama style, ethereal immortal with long flowing hair and silver hairpiece, snowy mystical backdrop, cold cinematic lighting, fantasy cultivation atmosphere', description: '电影级真人仙侠，冷冽仙气' },
  { name: '欧美写实Pro', value: 'western-pro', sortOrder: 9, prompt: 'photorealistic Western live-action film style, mature western character in tailored dark coat, modern city street backdrop, Hollywood cinematic color grading, realistic skin texture', description: '欧美真人电影质感，都市剧情氛围' },
  { name: '真人写实', value: 'real', sortOrder: 10, prompt: 'photorealistic live-action style, candid street photography, natural daylight, young woman waving on a bustling shopping street, realistic modern urban life', description: '自然真人街拍，现代都市' },
  { name: '真人古装', value: 'guzhuang', sortOrder: 11, prompt: 'photorealistic Chinese period style, gentle classical beauty in soft pink hanfu with floral hair ornaments, dreamy soft-focus garden backdrop', description: '柔美真人古装，古典庭院' },
  { name: '真人仙侠', value: 'xianxia', sortOrder: 12, prompt: 'photorealistic Chinese xianxia style, immortal in flowing white and blue robes standing before celestial palace above sea of clouds, ethereal fantasy atmosphere', description: '真人仙侠，云海仙宫' },
  { name: '真人废土', value: 'real-wasteland', sortOrder: 13, prompt: 'photorealistic post-apocalyptic wasteland style, gritty survivor with worn workwear and dirt-smudged face, dim cluttered workshop, dusty desaturated lighting', description: '真人末世废土，粗粝幸存者' },
  { name: '真人年代感', value: 'real-period', sortOrder: 14, prompt: 'photorealistic retro period drama style, nostalgic 1970s Chinese atmosphere, young woman with braided hair at vintage sewing machine, warm muted film grain', description: '真人怀旧年代剧质感' },
  { name: '2D国风动漫', value: 'guofeng-2d', sortOrder: 15, prompt: '2D Chinese guofeng anime style, elegant young swordsman in green and white hanfu, clean line art with ink wash shading, classical plum blossom and scroll painting backdrop', description: '2D 国风线稿，古典东方美学' },
  { name: '3D国风动漫', value: 'guofeng-3d', sortOrder: 16, prompt: '3D Chinese style animation render, refined CG girl in traditional red and gold hanfu, rich palace backdrop with lanterns and blossoms, semi-realistic stylized detail', description: '3D 国风 CG，华丽宫廷氛围' },
  { name: '动漫古言', value: 'anime-guyan', sortOrder: 17, prompt: 'soft painterly anime style, ancient Chinese romance setting, girl in yellow hanfu on a swing among blooming flowers, gentle pastel palette, delicate elegant character design', description: '唯美古风动漫，柔情花园' },
  { name: '动漫末世', value: 'anime-moshi', sortOrder: 18, prompt: 'dark gritty anime style, post-apocalyptic male survivor holding a torch, industrial ruin backdrop, high contrast dramatic shading, worn leather gear', description: '暗黑末世动漫，火把与废墟' },
  { name: '3D卡通', value: 'cartoon-3d', sortOrder: 19, prompt: 'polished 3D cartoon style, stylized princess character in sparkling blue ball gown, smooth rounded forms, vibrant saturated colors, animated feature film quality', description: '3D 卡通电影质感，公主角' },
  { name: '逼真3D渲染', value: 'render-3d', sortOrder: 20, prompt: 'ultra-realistic 3D render style, near-photoreal CG woman with transparent umbrella on rainy city street, detailed wet materials and cinematic reflections', description: '逼真 3D 渲染，雨天街景' },
  { name: '科幻写实', value: 'scifi-real', sortOrder: 21, prompt: 'sci-fi cinematic style, hooded hacker girl surrounded by neon holographic screens in a futuristic control room, cyberpunk blue-magenta lighting', description: '科幻赛博朋克，霓虹全息屏' },
  { name: '3D Q版', value: 'chibi-3d', sortOrder: 22, prompt: 'cute 3D chibi character style, big-head small-body boy in blue hoodie waving at a bus stop, toy-like smooth render, bright cheerful colors', description: '3D Q版萌系，玩具质感' },
  { name: '日系漫画', value: 'jp-manga', sortOrder: 23, prompt: 'Japanese manga illustration style, delicate line art with soft watercolor tones, schoolgirl with flowing hair under cherry blossoms, expressive shojo manga look', description: '日系少女漫画，樱花氛围' },
  { name: '新时代日漫', value: 'jp-anime-modern', sortOrder: 24, prompt: 'modern Japanese anime style, clean digital coloring, contemporary schoolgirl in pink cardigan on tree-lined street, soft natural lighting, refined character design', description: '新时代日漫，清新都市日常' },
  { name: '2D童话', value: 'fairytale-2d', sortOrder: 25, prompt: 'warm 2D storybook illustration style, girl reading a book by the window in a cozy room, soft warm palette, gentle hand-drawn picture book feel', description: '温暖手绘童话绘本风' },
  { name: '2D废土', value: 'wasteland-2d', sortOrder: 26, prompt: 'gritty 2D comic style, post-apocalyptic desert survivor with goggles and head wrap, dusty earthy palette, rough textured brushwork', description: '2D 粗粝废土，荒漠幸存者' },
  { name: '水墨武侠', value: 'ink-wuxia', sortOrder: 27, prompt: 'Chinese ink wash painting style, wuxia swordsman with oil-paper umbrella in misty mountains, minimalist black ink strokes, zen atmospheric negative space', description: '中式水墨山水，写意武侠' },
  { name: '熊猫头风格', value: 'panda-head', sortOrder: 28, prompt: 'Chinese meme cartoon style, exaggerated panda-head warrior with hilarious facial expression, bold flat colors, humorous rough sketch lines', description: '熊猫头表情包风，幽默夸张' },
  { name: '2D Q版', value: 'chibi-2d', sortOrder: 29, prompt: 'cute 2D chibi anime style, simple clean line art, school uniform girl on sunny city street, bright flat colors, lighthearted slice-of-life mood', description: '2D Q版萌系，清新日常' },
]

/**
 * 小说拆分提示词模版种子 — 系统内置（user_id NULL）：小说/诗词/幽默笑话
 * prompt 注入分集标题/概要生成环节，引导 AI 按模版风格拆分命名；
 * default_target_chars 为模版建议的每集目标字数（前端预填，用户可覆盖）
 */
export const novelSplitTemplateSeeds = [
  {
    name: '小说', value: 'novel', sortOrder: 1, defaultTargetChars: 15000, splitMode: 'chars', defaultParagraphs: null,
    prompt: '这是一部叙事型小说。请按小说章节边界拆分，每集保留完整的剧情起伏；标题需体现本集核心冲突与悬念（如“退婚当日，她亮出真实身份”），概要用一句话点明本集看点，语言风格贴近网文短剧的强节奏叙事。',
    description: '通用网文/小说拆分：按章节归组，强悬念标题 + 看点概要',
  },
  {
    name: '诗词', value: 'poetry', sortOrder: 2, defaultTargetChars: 2000, splitMode: 'paragraphs', defaultParagraphs: 20,
    prompt: '这是一部诗词作品集（诗/词/曲）。系统已按段落数量拆分（空行分隔的一段即一首/一组作品，每集固定段落数），请保持单首作品完整不要截断；标题使用作品首句或词牌名加主题（如“水调歌头·明月几时有”），概要说明作者、朝代与意境，语言雅致凝练。',
    description: '诗词曲赋拆分：按段落数归组（每集 20 段），标题雅致，注明作者与意境',
  },
  {
    name: '幽默笑话', value: 'humor', sortOrder: 3, defaultTargetChars: 3000, splitMode: 'paragraphs', defaultParagraphs: 15,
    prompt: '这是一部幽默笑话/段子合集。系统已按段落数量拆分（空行分隔的一段即一则笑话，每集固定段落数），严禁把一个笑话拦腰截断；标题轻松搞笑带包袱感（如“老板画饼翻车现场”），概要提炼笑点但不剧透结尾，语气轻松活泼。',
    description: '笑话段子拆分：按段落数归组（每集 15 段），标题轻松带包袱',
  },
]

// INSERT ... SELECT WHERE NOT EXISTS → 幂等：只补缺失行，不覆盖用户编辑，
// 且不会像 INSERT IGNORE 那样在每次启动时白白消耗自增 id；
// 查重限定 user_id IS NULL（系统内置行），避免用户的同名私有风格阻断回补
export const mysqlDataSeedStatements = [
  ...stylePresetSeeds.map((s) => ({
    sql: 'INSERT INTO `style_presets` (`name`, `value`, `prompt`, `description`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT ?, ?, ?, ?, ?, 1, NULL, ?, ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `style_presets` WHERE `value` = ? AND `user_id` IS NULL)',
    params: [s.name, s.value, s.prompt, s.description, s.sortOrder, new Date().toISOString(), new Date().toISOString(), s.value],
  })),
  ...novelSplitTemplateSeeds.map((s) => ({
    sql: 'INSERT INTO `novel_split_templates` (`name`, `value`, `prompt`, `description`, `default_target_chars`, `split_mode`, `default_paragraphs`, `sort_order`, `is_active`, `user_id`, `created_at`, `updated_at`) SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `novel_split_templates` WHERE `value` = ? AND `user_id` IS NULL)',
    params: [s.name, s.value, s.prompt, s.description, s.defaultTargetChars, s.splitMode, s.defaultParagraphs, s.sortOrder, new Date().toISOString(), new Date().toISOString(), s.value],
  })),
]

