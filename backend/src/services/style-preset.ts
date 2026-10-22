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
 * 风格预设解析服务
 * 把项目（dramas.style 存的是 style_presets.value）翻译成一段英文风格提示词。
 * 多租户下同名预设可能存在两份：先取项目属主自己的私有预设，再退到系统内置
 * （user_id 为 NULL）；停用或查无此预设时返回 ''，由调用方走各自兜底。
 * 生图/视频提示词组装属高频路径：预设全表走 60s TTL 进程内缓存（小表），
 * 写侧（routes/stylePresets.ts CRUD）调用 invalidateStylePresetCache 立即失效。
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { createTtlListCache } from './ttl-cache.js'

type PresetRow = typeof schema.stylePresets.$inferSelect

const presetCache = createTtlListCache<PresetRow>(() => db.select().from(schema.stylePresets))

/** 预设增删改后调用：清掉 60s 快照，改完立刻可见新值 */
export function invalidateStylePresetCache() {
  presetCache.invalidate()
}

/** 取项目绑定风格的英文提示词片段；项目、风格、预设任一缺失都返回 '' */
export async function getDramaStylePrompt(dramaId: number | null | undefined): Promise<string> {
  if (!dramaId) return ''
  // 轻投影：只取风格绑定需要的两列，不拉全行
  const [drama] = await db
    .select({ style: schema.dramas.style, userId: schema.dramas.userId })
    .from(schema.dramas)
    .where(eq(schema.dramas.id, dramaId))
  if (!drama?.style) return ''

  // 可见范围 = 属主私有 ∪ 系统内置；无属主的项目只能匹配系统内置
  const visible = (await presetCache.get()).filter(p =>
    p.isActive && p.value === drama.style && (p.userId === null || p.userId === drama.userId))
  // 私有（userId 非 NULL）压过同名内置（NULL），保持原 orderBy userId DESC 的私有优先语义
  const hit = visible.find(p => p.userId !== null) || visible.find(p => p.userId === null)
  return hit?.prompt || ''
}
