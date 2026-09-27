/**
 * Drama Mill — AI 短剧生成平台
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
/*
 * Drama Mill — 云端任务查询目标解析与本地↔云端比对（用户侧/管理侧共享）
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import type { CloudTaskItem } from './cloud-tasks-fetch.js'

/** api_key 掩码：只露前 4 后 4，展示他人网关时防泄露 */
export function maskApiKey(key: string | null | undefined): string {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return `${key.slice(0, 4)}****${key.slice(-4)}`
}

type ResolveResult =
  | { cfg: { id: number; name: string; provider: string | null; apiKey: string; model: string | null }; model: string; models: string[] }
  | { error: { status: 404 | 400; message: string } }

/**
 * 解析云端查询目标：config_id 优先，否则取启用的 dashscope 视频配置（优先级降序）；
 * 传 userId 时只在该用户的私有配置中选（任务用哪个 Key 提交，就要用同 Key 查询）；
 * 模型优先显式参数，配置 model 为 JSON 数组时返回全部模型（多池聚合查询），model 取首项为主模型；
 * 仍无法解析时从近 7 天本地任务动态推导，最后回退默认值。返回的 models 至少含 1 个元素
 */
export async function resolveCloudQueryTarget(configId?: number, modelParam?: string, userId?: number): Promise<ResolveResult> {
  let cfg
  if (configId) {
    const [row] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, configId))
    if (!row) return { error: { status: 404, message: 'AI 配置不存在' } }
    cfg = row
  } else {
    // WHERE 下推：视频类型 + dashscope + 启用（指定用户时再限定属主），优先级降序取首条
    const conds = [
      eq(schema.aiServiceConfigs.serviceType, 'video'),
      eq(schema.aiServiceConfigs.provider, 'dashscope'),
      eq(schema.aiServiceConfigs.isActive, true),
    ]
    if (userId != null) conds.push(eq(schema.aiServiceConfigs.userId, userId))
    const rows = await db.select().from(schema.aiServiceConfigs)
      .where(and(...conds))
      .orderBy(desc(schema.aiServiceConfigs.priority))
      .limit(1)
    cfg = rows[0]
    if (!cfg) return { error: { status: 400, message: userId != null ? '该用户未找到启用的视频生成配置' : '未找到启用的 dashscope 视频生成配置' } }
  }

  let model = (modelParam || '').trim()
  const models: string[] = []
  if (model) {
    // 显式指定模型：只查该单池（管理侧按模型排查场景）
    models.push(model)
  } else {
    const raw = (cfg.model || '').trim()
    if (raw.startsWith('[')) {
      try {
        const arr = JSON.parse(raw).filter((m: any) => typeof m === 'string' && m.trim())
        for (const m of arr) models.push(m.trim())
        model = models[0] || ''
      } catch { /* 非法 JSON，走动态推导 */ }
    } else if (raw) {
      model = raw
      models.push(raw)
    }
  }
  if (!model) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
    const recent = await db.select({ model: schema.sysTask.model, c: sql<number>`COUNT(*)` }).from(schema.sysTask)
      .where(and(eq(schema.sysTask.type, 'video'), sql`${schema.sysTask.createdAt} >= ${weekAgo}`))
      .groupBy(schema.sysTask.model)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(1)
    model = recent[0]?.model || 'wan3.0-video'
    models.push(model)
  }
  return { cfg, model, models }
}

export interface LocalTaskLite {
  id: number
  taskId: string | null
  status: string | null
  model: string | null
  dramaId: number | null
  storyboardId: number | null
  updatedAt: string
}

const toIso = (v: number | null) => (v ? new Date(v).toISOString() : null)

/** 将本地在途任务与云端集合比对：匹配 / 本地有云端无 / 云端有本地无 */
export function compareLocalWithCloud(
  byTaskId: Map<string, CloudTaskItem>,
  localRows: LocalTaskLite[],
) {
  const submitted = localRows.filter(t => !!t.taskId)
  const localTaskIds = new Set(submitted.map(t => t.taskId!))

  const matched: any[] = []
  const localOnly: any[] = []
  for (const t of submitted) {
    const ct = byTaskId.get(t.taskId!)
    const item = {
      local_id: t.id,
      task_id: t.taskId,
      local_status: t.status,
      cloud_status: ct?.status ?? null,
      model: t.model,
      drama_id: t.dramaId,
      storyboard_id: t.storyboardId,
      updated_at: t.updatedAt,
      cloud_created_at: ct ? toIso(ct.gmt_create) : null,
      cloud_started_at: ct ? toIso(ct.start_time) : null,
    }
    if (ct) matched.push(item)
    else localOnly.push(item)
  }

  const cloudOnly = [...byTaskId.values()]
    .filter(t => !localTaskIds.has(t.task_id))
    .sort((a, b) => b.gmt_create - a.gmt_create)
    .map(t => ({
      task_id: t.task_id,
      cloud_status: t.status,
      model: t.model_name,
      api_key_id: t.api_key_id,
      cloud_created_at: toIso(t.gmt_create),
      cloud_started_at: toIso(t.start_time),
    }))

  return {
    submittedCount: submitted.length,
    notSubmittedCount: localRows.length - submitted.length,
    matched,
    localOnly,
    cloudOnly,
  }
}
