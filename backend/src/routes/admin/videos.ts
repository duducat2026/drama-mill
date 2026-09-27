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
import { probeHistoricalTask, retryTask } from '../../services/generation.js'
import { ABANDONED_RETRY_COUNT, AUTO_RETRY_HARD_MAX, getAutoRetryMax, isAbandonedTask, setAutoRetryMax } from '../../services/runtime-config.js'
import { GEN_TASK_AUTO_RETRY_MAX } from '../../utils/rate-config.js'
import { badRequest, notFound, now, success } from '../../utils/response.js'
import { toSnakeCase } from '../../utils/transform.js'
import { and, count, desc, eq, inArray, like, or } from 'drizzle-orm'
import { pageOf, tooDeep, userMap } from './shared.js'
import { cachedTotal, countKey } from './count-cache.js'

const app = new Hono()

// ─── 7. 平台视频列表（sys_task） ───

/** 一键重提批量上限：历史失败可能很多，重提走生成队列受闸门约束，仍限量防一次性灌满队列 */
const BULK_RETRY_CAP = 100

// GET /admin/task-retry-config — 单任务失败自动重提上限（运行时配置优先，回退环境变量默认）
app.get('/task-retry-config', async (c) => {
  return success(c, {
    auto_retry_max: await getAutoRetryMax(),
    hard_max: AUTO_RETRY_HARD_MAX,
    env_default: Math.max(0, Math.min(AUTO_RETRY_HARD_MAX, GEN_TASK_AUTO_RETRY_MAX)),
    abandoned_retry_count: ABANDONED_RETRY_COUNT,
  })
})

// PUT /admin/task-retry-config — 修改自动重提上限（0~9 整数，0 = 关闭自动恢复，无需重启即时生效）
app.put('/task-retry-config', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const v = await setAutoRetryMax(body.auto_retry_max)
    return success(c, { auto_retry_max: v })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// POST /admin/videos/retry-failed — 一键重提失败的视频任务（最近优先，上限 BULK_RETRY_CAP 条）
app.post('/videos/retry-failed', async (c) => {
  let rows = await db.select().from(schema.sysTask)
  rows = rows.filter(t => t.type === 'video' && t.status === 'failed')
  // 人工放弃的任务不参与一键重提（需先逐个复活，避免无法处理的任务被反复提交）
  const abandoned = rows.filter(t => isAbandonedTask(t.retryCount)).length
  rows = rows.filter(t => !isAbandonedTask(t.retryCount))
  rows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  const targets = rows.slice(0, BULK_RETRY_CAP)
  let retried = 0
  const skipped: number[] = []
  for (const t of targets) {
    try {
      await retryTask(t.id)
      retried++
    } catch {
      skipped.push(t.id)
    }
  }
  return success(c, { retried, skipped: skipped.length, abandoned, total_failed: rows.length + abandoned })
})

// POST /admin/videos/:id/retry — 重提单个失败任务（手动重试重置重试计数）
app.post('/videos/:id/retry', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (!row) return notFound(c, '任务不存在')
  if (row.type !== 'video') return badRequest(c, '仅支持重提视频生成任务')
  try {
    await retryTask(id)
    return success(c, { id })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// POST /admin/videos/:id/abandon — 放弃失败任务：置放弃标记后自动重提/手动重试/资产补跑全部停止，
// 用于无法处理的任务（内容永远过不了审、上游资源永久失效等），防止被反复提交白耗配额
app.post('/videos/:id/abandon', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (!row) return notFound(c, '任务不存在')
  if (row.type !== 'video') return badRequest(c, '仅支持放弃视频生成任务')
  if (row.status !== 'failed') return badRequest(c, '仅失败任务可放弃')
  if (isAbandonedTask(row.retryCount)) return success(c, { id, already_abandoned: true })
  await db.update(schema.sysTask)
    .set({ retryCount: ABANDONED_RETRY_COUNT, errorMsg: `[已放弃] ${row.errorMsg || '生成失败'}`, updatedAt: now() })
    .where(eq(schema.sysTask.id, id))
  return success(c, { id })
})

// POST /admin/videos/:id/restore — 复活已放弃任务：清除放弃标记（重试计数归零），保留 failed 状态可再重试；
// 同时解放资产补跑看门狗对该资产的跳过（复活后手动重试/自动恢复均可介入）
app.post('/videos/:id/restore', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (!row) return notFound(c, '任务不存在')
  if (!isAbandonedTask(row.retryCount)) return badRequest(c, '任务未被放弃，无需复活')
  await db.update(schema.sysTask)
    .set({ retryCount: 0, errorMsg: (row.errorMsg || '').replace(/^\[已放弃\]\s*/, '') || null, updatedAt: now() })
    .where(eq(schema.sysTask.id, id))
  return success(c, { id })
})

/** 历史任务补跑单次上限：探测是轻量查询，但仍限量避免一次性打满上游 */
const HISTORICAL_RESCUE_CAP = 500

// POST /admin/videos/rescue-historical — 历史任务补跑：探测带上游 task_id 的失败视频任务，
// 上游已生成完→直接救回落库，仍在生成→恢复轮询；均不重新提交、不消耗重试额度（避免重复计费）
app.post('/videos/rescue-historical', async (c) => {
  let rows = await db.select().from(schema.sysTask)
  rows = rows.filter(t => t.type === 'video' && t.status === 'failed' && !!t.taskId)
  rows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  const targets = rows.slice(0, HISTORICAL_RESCUE_CAP)

  let rescued = 0, resumed = 0
  const skipped: number[] = []
  // 小批量并发探测（轻量 GET），串行太慢、全并发怕打满上游网关
  for (let i = 0; i < targets.length; i += 5) {
    const batch = targets.slice(i, i + 5)
    const results = await Promise.all(batch.map(async t => {
      try {
        return await probeHistoricalTask(t.id)
      } catch {
        return 'resubmit'
      }
    }))
    results.forEach((r, j) => {
      if (r === 'completed') rescued++
      else if (r === 'pending') resumed++
      else skipped.push(batch[j].id)
    })
  }
  return success(c, { probed: targets.length, rescued, resumed, skipped: skipped.length, total_eligible: rows.length })
})

// GET /admin/videos?user_id=&drama_id=&status=&keyword=&page=
app.get('/videos', async (c) => {
  const { page, pageSize } = pageOf(c)
  if (tooDeep(page, pageSize)) return badRequest(c, '翻页过深，请用用户/状态/关键词过滤后查询')
  const userId = Number(c.req.query('user_id')) || undefined
  const dramaId = Number(c.req.query('drama_id')) || undefined
  const status = c.req.query('status')
  const keyword = (c.req.query('keyword') || '').trim()

  // type/user/drama/status/keyword 与排序分页全部下推 SQL，不再全表 sys_task 载入 Node
  const conds = [eq(schema.sysTask.type, 'video')]
  if (userId) conds.push(eq(schema.sysTask.userId, userId))
  if (dramaId) conds.push(eq(schema.sysTask.dramaId, dramaId))
  if (status) conds.push(eq(schema.sysTask.status, status))
  if (keyword) {
    const kw = `%${keyword}%`
    const titleDramaIds = (await db.select({ id: schema.dramas.id }).from(schema.dramas).where(like(schema.dramas.title, kw))).map(d => d.id)
    conds.push(or(
      like(schema.sysTask.prompt, kw),
      like(schema.sysTask.model, kw),
      titleDramaIds.length ? inArray(schema.sysTask.dramaId, titleDramaIds) : undefined,
    )!)
  }
  const where = and(...conds)
  const [rows, total] = await Promise.all([
    db.select().from(schema.sysTask).where(where)
      .orderBy(desc(schema.sysTask.createdAt), desc(schema.sysTask.id))
      .limit(pageSize).offset((page - 1) * pageSize),
    // COUNT(*) 缓存 60s：翻页/刷新不重复计数；key 覆盖全部影响行数的过滤条件
    cachedTotal(countKey('admin:videos', userId, dramaId, status, keyword), async () => {
      const [r] = await db.select({ c: count() }).from(schema.sysTask).where(where)
      return Number(r?.c) || 0
    }),
  ])

  // 仅解析当页涉及的用户名/剧集名（不再全表 userMap/dramaTitle）
  const uidSet = [...new Set(rows.map(t => t.userId).filter((v): v is number => !!v))]
  const didSet = [...new Set(rows.map(t => t.dramaId).filter((v): v is number => !!v))]
  const users = uidSet.length
    ? new Map((await db.select({ id: schema.users.id, username: schema.users.username }).from(schema.users).where(inArray(schema.users.id, uidSet))).map(u => [u.id, u.username]))
    : new Map<number, string>()
  const dramaTitle = didSet.length
    ? new Map((await db.select({ id: schema.dramas.id, title: schema.dramas.title }).from(schema.dramas).where(inArray(schema.dramas.id, didSet))).map(d => [d.id, d.title]))
    : new Map<number, string>()

  return success(c, {
    total,
    page,
    page_size: pageSize,
    items: rows.map(t => ({
      ...toSnakeCase(t),
      drama_title: t.dramaId ? dramaTitle.get(t.dramaId) ?? null : null,
      username: t.userId ? users.get(t.userId) ?? null : null,
    })),
  })
})


export default app
