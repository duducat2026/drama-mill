/*
 * Drama Mill — 任务路由共享层：归属校验 + 诊断字段解析
 */

import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { maskApiKey } from '../services/cloud-tasks.js'
import { getDramaOwned, OwnershipError } from '../services/ownership.js'
import type { AuthUser } from '../services/auth.js'

export type TaskType = 'image' | 'video'

/** 任务归属：经任务所属项目间接校验；无项目但落了 user_id 的任务（设置页生成测试等）按本人归属校验；
 *  两者都没有的历史任务放行 */
export async function getTaskOwned(id: number, user: AuthUser) {
  const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (!row) throw new OwnershipError(404, '任务不存在')
  if (row.dramaId) await getDramaOwned(row.dramaId, user)
  else if (row.userId != null && row.userId !== user.id) throw new OwnershipError(404, '任务不存在')
  return row
}

/** 任务 params / metadata 等 JSON 文本列：解析失败一律当空对象，诊断接口不该因脏数据报错 */
export function parseJsonField(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export function toMs(v: string | null | undefined): number {
  return v ? Date.parse(v) : NaN
}

/** 诊断用的配置上下文：定位「这次到底用的哪份配置/哪个 Key/哪个地址」，密钥仅回掩码 */
export async function loadTaskConfigBrief(configId: number) {
  const [cfg] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, configId))
  if (!cfg) return { id: configId, name: '', provider: '', base_url: '', api_key: '', is_active: false, missing: true }
  return {
    id: cfg.id,
    name: cfg.name || '',
    provider: cfg.provider || '',
    service_type: cfg.serviceType,
    base_url: cfg.baseUrl || '',
    api_key: maskApiKey(cfg.apiKey),
    is_active: !!cfg.isActive,
    missing: false,
  }
}
