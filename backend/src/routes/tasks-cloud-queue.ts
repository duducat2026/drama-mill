/*
 * Drama Mill — GET /tasks/cloud-queue：用户侧云端排队状态处理
 */

import type { Context } from 'hono'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { badRequest, success } from '../utils/response.js'
import {
  compareLocalWithCloud,
  fetchCloudVideoTasksMulti,
  maskApiKey,
  resolveCloudQueryTarget,
} from '../services/cloud-tasks.js'
import { ownedDramaIds } from '../services/ownership.js'
import type { AuthUser } from '../services/auth.js'

/** 用本人视频配置（模型 + API-KEY）查询上游排队，与提交任务所用 Key 保持一致；
 *  仅比对本人在途任务，返回掩码后的本人配置，避免泄露主账号级信息 */
export async function handleCloudQueue(c: Context) {
  const user = c.get('user') as AuthUser
  const resolved = await resolveCloudQueryTarget(undefined, c.req.query('model'), user.id)
  if ('error' in resolved) {
    return badRequest(c, resolved.error.message)
  }
  const { cfg, model, models } = resolved

  // 多池聚合：配置内多个视频模型各有限流池，聚合全部池才是真实在途全貌；显式传 model 时只查单池
  const cloud = await fetchCloudVideoTasksMulti(cfg.apiKey, models)

  // 本人归属：无项目关联的任务只放行「未落 user_id 的历史任务」与本人任务，其余限定自有项目；限量防全表加载
  const owned = await ownedDramaIds(user)
  const ownerCond = or(
    and(
      isNull(schema.sysTask.dramaId),
      sql`(${schema.sysTask.userId} IS NULL OR ${schema.sysTask.userId} = ${user.id})`,
    ),
    ...(owned.size ? [inArray(schema.sysTask.dramaId, [...owned])] : []),
  )
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
    // 本人的视频配置（Key 掩码），让用户确认查询用的是自己的模型/网关
    config: { id: cfg.id, name: cfg.name, api_key: maskApiKey(cfg.apiKey) },
    cloud: {
      pending_total: cloud.pending.total,
      running_total: cloud.running.total,
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
    generated_at: new Date().toISOString(),
  })
}
