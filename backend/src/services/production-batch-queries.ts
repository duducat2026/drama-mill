/**
 * Drama Mill — AI 短剧生成平台
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
/*
 * Drama Mill — production-batch 查询层：批次详情、批次列表（只读，不修改状态）
 */
import { eq, and, asc, isNull, inArray, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { getProductionRun } from './production.js'

/** 批次详情：批次 + 条目（附短剧/小说标题与生产进度快照） */
export async function getBatchDetail(batchId: number) {
  const [batch] = await db.select().from(schema.productionBatches).where(eq(schema.productionBatches.id, batchId))
  if (!batch) return null
  const items = await db.select().from(schema.productionBatchItems)
    .where(eq(schema.productionBatchItems.batchId, batchId)).orderBy(asc(schema.productionBatchItems.seq))

  // 批量查询：避免 N+1，一次查出所有 drama 和 novel
  const dramaIds = [...new Set(items.map(it => it.dramaId))]
  const novelIds = [...new Set(items.map(it => it.novelId))]
  const [dramaRows, novelRows] = await Promise.all([
    dramaIds.length
      ? db.select({ id: schema.dramas.id, title: schema.dramas.title, status: schema.dramas.status })
          .from(schema.dramas).where(inArray(schema.dramas.id, dramaIds))
      : Promise.resolve([]),
    novelIds.length
      ? db.select({ id: schema.novels.id, title: schema.novels.title, charCount: schema.novels.charCount, splitStatus: schema.novels.splitStatus })
          .from(schema.novels).where(inArray(schema.novels.id, novelIds))
      : Promise.resolve([]),
  ])
  const dramaMap = new Map(dramaRows.map(d => [d.id, d]))
  const novelMap = new Map(novelRows.map(n => [n.id, n]))

  const details = []
  for (const it of items) {
    const drama = dramaMap.get(it.dramaId)
    const novel = novelMap.get(it.novelId)
    const run = it.status === 'producing' ? getProductionRun(it.dramaId) : null
    details.push({
      id: it.id,
      seq: it.seq,
      drama_id: it.dramaId,
      drama_title: drama?.title || `#${it.dramaId}`,
      drama_status: drama?.status || null,
      novel_id: it.novelId,
      novel_title: novel?.title || `#${it.novelId}`,
      char_count: novel?.charCount || 0,
      status: it.status,
      error: it.error,
      started_at: it.startedAt,
      finished_at: it.finishedAt,
      // 生产中条目的实时环节快照
      production: run ? {
        current_episode_number: run.current_episode_number,
        current_step: run.current_step,
      } : null,
    })
  }
  const counts = { total: details.length, done: 0, failed: 0, running: 0, pending: 0, split_done: 0 }
  for (const d of details) {
    if (d.status === 'done') counts.done++
    else if (d.status === 'failed' || d.status === 'split_failed') counts.failed++
    else if (d.status === 'splitting' || d.status === 'producing') counts.running++
    else if (d.status === 'split_done') counts.split_done++
    else if (d.status === 'pending') counts.pending++
  }
  return {
    id: batch.id,
    status: batch.status,
    mode: batch.mode,
    split_mode: batch.splitMode,
    paragraphs_per_episode: batch.paragraphsPerEpisode,
    target_chars: batch.targetChars,
    has_split_prompt: !!batch.splitPrompt,
    error: batch.error,
    started_at: batch.startedAt,
    finished_at: batch.finishedAt,
    created_at: batch.createdAt,
    counts,
    items: details,
  }
}

/** 用户的批次列表（概要）：只取最近 100 批，条目计数 GROUP BY 下推 SQL */
const LIST_BATCHES_LIMIT = 100
export async function listBatches(userId: number) {
  const rows = await db.select().from(schema.productionBatches)
    .where(and(eq(schema.productionBatches.userId, userId), isNull(schema.productionBatches.deletedAt)))
    .orderBy(sql`${schema.productionBatches.id} DESC`)
    .limit(LIST_BATCHES_LIMIT)
  if (!rows.length) return []

  const batchIds = rows.map(r => r.id)
  const statusCounts = await db.select({
    batchId: schema.productionBatchItems.batchId,
    status: schema.productionBatchItems.status,
    cnt: sql<number>`COUNT(*)`,
  }).from(schema.productionBatchItems)
    .where(inArray(schema.productionBatchItems.batchId, batchIds))
    .groupBy(schema.productionBatchItems.batchId, schema.productionBatchItems.status)
  const countMap = new Map<number, Record<string, number>>()
  for (const r of statusCounts) {
    const m = countMap.get(r.batchId) || {}
    m[r.status || ''] = Number(r.cnt)
    countMap.set(r.batchId, m)
  }

  const currentByBatch = new Map<number, typeof schema.productionBatchItems.$inferSelect>()
  if (rows.some(r => r.status === 'running' || r.status === 'pending')) {
    const activeItems = await db.select().from(schema.productionBatchItems)
      .where(and(
        inArray(schema.productionBatchItems.batchId, batchIds),
        inArray(schema.productionBatchItems.status, ['splitting', 'producing']),
      ))
      .orderBy(asc(schema.productionBatchItems.batchId), asc(schema.productionBatchItems.seq))
    for (const it of activeItems) {
      if (!currentByBatch.has(it.batchId)) currentByBatch.set(it.batchId, it)
    }
  }

  return rows.map(row => {
    const c = countMap.get(row.id) || {}
    const splitDone = c.split_done || 0
    return {
      id: row.id,
      status: row.status,
      mode: row.mode,
      total: Object.values(c).reduce((s, n) => s + n, 0),
      done: c.done || 0,
      failed: (c.failed || 0) + (c.split_failed || 0),
      split_done: splitDone,
      current: currentByBatch.get(row.id) || null,
      created_at: row.createdAt,
      finished_at: row.finishedAt,
    }
  })
}
