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

import { Hono } from 'hono'
import { db, schema } from '../../db/index.js'
import { compareLocalWithCloud, fetchCloudVideoTasksMulti, maskApiKey, resolveCloudQueryTarget } from '../../services/cloud-tasks.js'
import { badRequest, notFound, now, success } from '../../utils/response.js'
import { and, eq, inArray, or, sql } from 'drizzle-orm'

const app = new Hono()

// ─── 14. 云端队列状态（DashScope 批量任务接口与本地库比对） ───

// GET /admin/cloud-queue?model=&config_id=&user_id= — 查询云端排队/在途任务并与本地 sys_task 比对
// user_id：加载该用户的视频配置（模型 + API-KEY）查询，本地比对也限定该用户的任务；
// 云端列表覆盖主账号下所有 API Key 提交的任务，故 cloud_only 可能来自同账号其他 Key/进程
app.get('/cloud-queue', async (c) => {
  const userId = Number(c.req.query('user_id')) || undefined
  const resolved = await resolveCloudQueryTarget(
    Number(c.req.query('config_id')) || undefined,
    c.req.query('model'),
    userId,
  )
  if ('error' in resolved) {
    return resolved.error.status === 404
      ? notFound(c, resolved.error.message)
      : badRequest(c, resolved.error.message)
  }
  const { cfg, model, models } = resolved

  // 多池聚合：配置内多个视频模型各有限流池，聚合全部池才是真实在途全貌；显式传 model 时只查单池
  const cloud = await fetchCloudVideoTasksMulti(cfg.apiKey, models)

  // 指定用户：本地在途限定该用户（本人提交 + 自有项目）；否则全量视角（限量防全表加载）
  let ownerCond
  let userInfo: { id: number; username: string; nickname: string | null } | null = null
  if (userId) {
    const [u] = await db.select({
      id: schema.users.id,
      username: schema.users.username,
      nickname: schema.users.nickname,
    }).from(schema.users).where(eq(schema.users.id, userId))
    if (u) userInfo = u
    const dramaRows = await db.select({ id: schema.dramas.id }).from(schema.dramas)
      .where(eq(schema.dramas.userId, userId))
    const ids = dramaRows.map(r => r.id)
    ownerCond = ids.length
      ? or(eq(schema.sysTask.userId, userId), inArray(schema.sysTask.dramaId, ids))
      : eq(schema.sysTask.userId, userId)
  }
  const localRows = await db.select({
    id: schema.sysTask.id,
    taskId: schema.sysTask.taskId,
    status: schema.sysTask.status,
    model: schema.sysTask.model,
    dramaId: schema.sysTask.dramaId,
    storyboardId: schema.sysTask.storyboardId,
    updatedAt: schema.sysTask.updatedAt,
  }).from(schema.sysTask)
    .where(and(eq(schema.sysTask.type, 'video'), eq(schema.sysTask.status, 'processing'), ownerCond))
    .orderBy(sql`${schema.sysTask.id} DESC`)
    .limit(500)

  const cmp = compareLocalWithCloud(cloud.byTaskId, localRows)

  return success(c, {
    model,
    models,
    user: userInfo,
    config: { id: cfg.id, name: cfg.name, provider: cfg.provider, api_key: maskApiKey(cfg.apiKey) },
    cloud: {
      pending_total: cloud.pending.total,
      running_total: cloud.running.total,
      pending_fetched: cloud.pending.items.length,
      running_fetched: cloud.running.items.length,
      truncated: cloud.pending.truncated || cloud.running.truncated,
      error: cloud.pending.error || cloud.running.error,
      by_model: cloud.byModel,
    },
    local: {
      in_flight: localRows.length,
      submitted: cmp.submittedCount,
      not_submitted: cmp.notSubmittedCount,
      matched: cmp.matched.length,
      local_only: cmp.localOnly.length,
    },
    cloud_only_total: cmp.cloudOnly.length,
    matched: cmp.matched,
    local_only: cmp.localOnly,
    cloud_only: cmp.cloudOnly,
    generated_at: now(),
  })
})


export default app
