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

import { Hono } from 'hono'
import { db, schema } from '../../db/index.js'
import { badRequest, success } from '../../utils/response.js'
import { and, count, desc, eq, inArray, isNull, like, or } from 'drizzle-orm'
import { pageOf, tooDeep } from './shared.js'
import { cachedTotal, countKey } from './count-cache.js'

const app = new Hono()

// ─── 6. 平台分镜查看 ───

// GET /admin/storyboards?user_id=&drama_id=&keyword=&page=
app.get('/storyboards', async (c) => {
  const { page, pageSize } = pageOf(c)
  if (tooDeep(page, pageSize)) return badRequest(c, '翻页过深，请用用户/关键词过滤后查询')
  const userId = Number(c.req.query('user_id')) || undefined
  const dramaId = Number(c.req.query('drama_id')) || undefined
  const keyword = (c.req.query('keyword') || '').trim()

  // 三表 join（storyboards→episodes→dramas）+ 筛选/排序/分页下推 SQL，不再全表 storyboards 载入 Node
  const S = schema.storyboards
  const E = schema.episodes
  const D = schema.dramas
  const where = and(
    isNull(S.deletedAt),
    userId ? eq(D.userId, userId) : undefined,
    dramaId ? eq(E.dramaId, dramaId) : undefined,
    keyword ? or(like(D.title, `%${keyword}%`), like(S.title, `%${keyword}%`), like(S.videoPrompt, `%${keyword}%`)) : undefined,
  )
  const cols = {
    id: S.id, storyboardNumber: S.storyboardNumber, title: S.title, videoPrompt: S.videoPrompt,
    status: S.status, createdAt: S.createdAt, videoUrl: S.videoUrl,
    epTitle: E.title, epNumber: E.episodeNumber, dId: D.id, dTitle: D.title, dUserId: D.userId,
  }
  const [rows, total] = await Promise.all([
    db.select(cols).from(S)
      .innerJoin(E, eq(S.episodeId, E.id))
      .innerJoin(D, eq(E.dramaId, D.id))
      .where(where).orderBy(desc(S.createdAt), desc(S.id)).limit(pageSize).offset((page - 1) * pageSize),
    // 三表 join 的 COUNT(*) 尤为昂贵：按过滤条件缓存 60s
    cachedTotal(countKey('admin:storyboards', userId, dramaId, keyword), async () => {
      const [r] = await db.select({ c: count() }).from(S)
        .innerJoin(E, eq(S.episodeId, E.id))
        .innerJoin(D, eq(E.dramaId, D.id))
        .where(where)
      return Number(r?.c) || 0
    }),
  ])

  const uidSet = [...new Set(rows.map(r => r.dUserId).filter((v): v is number => !!v))]
  const users = uidSet.length
    ? new Map((await db.select({ id: schema.users.id, username: schema.users.username }).from(schema.users).where(inArray(schema.users.id, uidSet))).map(u => [u.id, u.username]))
    : new Map<number, string>()

  return success(c, {
    total,
    page,
    page_size: pageSize,
    items: rows.map(r => ({
      id: r.id,
      drama_id: r.dId,
      drama_title: r.dTitle ?? null,
      episode_title: r.epTitle ?? null,
      episode_number: r.epNumber ?? null,
      storyboard_number: r.storyboardNumber,
      title: r.title,
      video_prompt: r.videoPrompt,
      status: r.status,
      video_url: r.videoUrl,
      created_at: r.createdAt,
      username: r.dUserId ? users.get(r.dUserId) ?? null : null,
    })),
  })
})


export default app
