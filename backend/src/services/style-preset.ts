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
 * 风格预设解析服务
 * 把项目（dramas.style 存的是 style_presets.value）翻译成一段英文风格提示词。
 * 多租户下同名预设可能存在两份：先取项目属主自己的私有预设，再退到系统内置
 * （user_id 为 NULL）；停用或查无此预设时返回 ''，由调用方走各自兜底。
 */
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

/** 取项目绑定风格的英文提示词片段；项目、风格、预设任一缺失都返回 '' */
export async function getDramaStylePrompt(dramaId: number | null | undefined): Promise<string> {
  if (!dramaId) return ''
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama?.style) return ''

  // 可见范围 = 属主私有 ∪ 系统内置；无属主的项目只能匹配系统内置
  const visibleTo = drama.userId
    ? or(eq(schema.stylePresets.userId, drama.userId), isNull(schema.stylePresets.userId))
    : isNull(schema.stylePresets.userId)

  // orderBy userId DESC 让私有（非 NULL）压过同名内置（NULL），实现私有优先
  const matches = await db
    .select({ prompt: schema.stylePresets.prompt })
    .from(schema.stylePresets)
    .where(
      and(
        eq(schema.stylePresets.value, drama.style),
        eq(schema.stylePresets.isActive, true),
        visibleTo,
      )
    )
    .orderBy(desc(schema.stylePresets.userId))
    .limit(1)

  return matches[0]?.prompt || ''
}
