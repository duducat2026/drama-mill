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
 * 风格预设服务 — 将项目绑定的视觉风格解析为英文提示词片段
 * dramas.style 存 style_presets.value；多租户匹配优先项目属主的私有风格，
 * 找不到再回退系统内置（user_id NULL）；均查不到/已停用时返回空串（调用方走兜底）
 */
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

/** 查询项目绑定的风格预设英文提示词片段；查不到返回 '' */
export async function getDramaStylePrompt(dramaId: number | null | undefined): Promise<string> {
  if (!dramaId) return ''
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama?.style) return ''
  const scope = drama.userId
    ? or(eq(schema.stylePresets.userId, drama.userId), isNull(schema.stylePresets.userId))
    : isNull(schema.stylePresets.userId)
  // user_id DESC：非 NULL（私有）排在 NULL（内置）前，私有命中优先
  const [preset] = await db.select().from(schema.stylePresets)
    .where(and(
      eq(schema.stylePresets.value, drama.style),
      eq(schema.stylePresets.isActive, true),
      scope,
    ))
    .orderBy(desc(schema.stylePresets.userId))
    .limit(1)
  return preset?.prompt || ''
}
