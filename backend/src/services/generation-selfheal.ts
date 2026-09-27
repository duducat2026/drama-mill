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
 * 提交前预检与配置故障自愈（拆分自 generation.ts）：
 * 敏感词改写预检、未开通配置换配置重排、素材链接失效快速重排、失败落库与恢复配置解析。
 */
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { getResumeConfig, parseConfigQpm } from './ai.js'
import { now } from '../utils/response.js'
import { logTaskError, logTaskProgress, logTaskWarn } from '../utils/task-logger.js'
import { ABANDONED_RETRY_COUNT } from './runtime-config.js'
import type { AIConfig } from './adapters/types'
import { enqueueExecution } from './generation-queue.js'
import { isConfigTestParams, parseTaskParams, taskLabel } from './generation-shared.js'
import type { SysTaskRecord, TaskType } from './generation-shared.js'

// 绿网修正模块动态加载缓存：避免 generation ↔ moderation-fix 静态循环引用（仅首次失败时加载）
let moderationFixModule: Promise<typeof import('./moderation-fix.js')> | null = null

// ─── 提交前预检与配置故障自愈（视频链路专用） ───

/** 配置已购买性错误：上游明确提示模型未开通/未购买（区别于一般 403 权限问题，必须换配置才能成功） */
export function isUnpurchasedError(msg: string | null | undefined): boolean {
  return !!msg && /AccessDenied\.Unpurchased|access to model denied/i.test(msg)
}

/** 参考素材链接失效：上游下载输入的签名/临时链接过期（深排队超过链接有效期所致），重提会重新构建素材 */
export function isAssetExpiryError(msg: string | null | undefined): boolean {
  return !!msg && /Failed to download/i.test(msg)
}

// 素材失效快速重排上限：水位限流生效后深排队基本消失，留 2 次兜底防个别链接提前过期，防无限重排
const ASSET_EXPIRY_REQUEUE_MAX = 2

/**
 * 视频任务提交前预检：敏感词命中则文本 AI 改写后再提交，避免排队后才被绿网拦截白耗整轮等待；
 * 与失败后修正共用额度（moderationFixCount）与项目开关；返回改写后的提示词，未改写返回 null。
 * （素材签名链接失效无需在此处理：参考图每次提交都会重新归一化重建，见 generation-refs.ts）
 */
export async function preSubmitVideoPrecheck(record: SysTaskRecord, params: Record<string, any>): Promise<string | null> {
  if (params.configTest || !record.prompt?.trim()) return null
  moderationFixModule ??= import('./moderation-fix.js')
  const mod = await moderationFixModule
  if (!(await mod.isGreenNetFixEnabled(record.dramaId))) return null
  const fixCount = Number(params.moderationFixCount) || 0
  if (fixCount >= mod.getGreenNetFixMax()) return null
  if (!mod.hasSensitiveTerms(record.prompt)) return null

  logTaskProgress('GreenNetPrecheck', 'rewrite-start', { id: record.id, fixCount: fixCount + 1, dramaId: record.dramaId })
  const fixed = await mod.rewritePromptForModeration(record.prompt, record.type, record.userId, 'precheck')
  if (!fixed) return null
  try {
    const meta = await (await import('./ai.js')).resolveTextConfigMeta(record.userId)
    await (await import('./cost.js')).recordTextUsageFromResult(fixed.result, meta, {
      userId: record.userId ?? null,
      dramaId: record.dramaId ?? null,
      detail: `green_net_precheck#task${record.id}`,
    })
  } catch { /* 成本记录失败不阻断预检 */ }
  const nextParams = { ...params, moderationFixCount: fixCount + 1 }
  await db.update(schema.sysTask)
    .set({ prompt: fixed.text, params: JSON.stringify(nextParams), updatedAt: now() })
    .where(eq(schema.sysTask.id, record.id))
  logTaskProgress('GreenNetPrecheck', 'rewrite-done', { id: record.id, fixCount: fixCount + 1, originalLen: record.prompt.length, fixedLen: fixed.text.length })
  return fixed.text
}

/**
 * 素材链接失效快速重排（提交阶段与轮询阶段共用）：
 * 计数内重新入队重建素材（重新归一化参考图即得新链接），不消耗重试额度；超上限返回 false 落失败。
 */
export async function requeueExpiredAssetTask(id: number): Promise<boolean> {
  const [record] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (!record || record.status !== 'processing') return false
  const params = parseTaskParams(record.params)
  if (params.configTest) return false
  const requeueCount = Number(params.assetExpiryRequeue) || 0
  if (requeueCount >= ASSET_EXPIRY_REQUEUE_MAX) return false
  const config = await resolveResumeConfig(record.type as TaskType, record.provider, record.userId)
  if (!config) return false
  const nextParams = { ...params, assetExpiryRequeue: requeueCount + 1 }
  await db.update(schema.sysTask)
    .set({ taskId: null, params: JSON.stringify(nextParams), updatedAt: now() })
    .where(eq(schema.sysTask.id, id))
  logTaskWarn(taskLabel(record.type as TaskType), 'asset-expiry-requeued', { id, requeueCount: requeueCount + 1 })
  enqueueExecution(id, config, record.type as TaskType, record.model || config.model)
  return true
}

/**
 * 提交阶段配置故障自愈：
 * - 模型未开通（AccessDenied.Unpurchased）：清掉任务锁定的配置（集级锁定会一直选中失效配置），
 *   置回 processing 后重新入队，让活跃配置接管；无任何可用配置时返回 false 落失败。
 * - 素材链接失效：转发快速重排。
 */
export async function maybeHandleConfigFailure(id: number, message: string): Promise<boolean> {
  // 单次生成测试不做配置自愈：自动停用配置/换配置重提会让「测这一份配置」变成测别家，且重复计费
  if (await isConfigTestTask(id)) return false
  if (isAssetExpiryError(message)) return requeueExpiredAssetTask(id)

  if (isUnpurchasedError(message)) {
    const [record] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
    if (!record || record.status !== 'processing') return false
    const params = parseTaskParams(record.params)
    const hadLock = params.configId != null
    // 在途任务的自愈重排不过总开关（开关判定统一在 processTask 提交前），避免在 catch 内抛出打断失败处理
    const fallback = await getResumeConfig(record.type as TaskType, record.userId ?? undefined)
    // 清锁定后仍解析到同一失效配置（无其它可用配置）：不再自动重排，落失败留给人工换配置/开通模型；
    // 同时停用失效配置，防止后续新任务继续选中它（仅当还有其它可用配置时停用，避免误伤唯一配置）
    if (fallback && hadLock && fallback.configId !== params.configId && params.configId) {
      await db.update(schema.aiServiceConfigs)
        .set({ isActive: false, updatedAt: now() })
        .where(eq(schema.aiServiceConfigs.id, params.configId))
      logTaskWarn('AIConfig', 'auto-deactivated-unpurchased', { configId: params.configId, error: message.slice(0, 160) })
    }
    if (!fallback || (hadLock && fallback.configId === params.configId)) return false
    const oldConfigId = params.configId
    delete params.configId
    await db.update(schema.sysTask)
      .set({ taskId: null, params: JSON.stringify(params), updatedAt: now() })
      .where(eq(schema.sysTask.id, id))
    logTaskWarn(taskLabel(record.type as TaskType), 'config-unpurchased-requeued', { id, oldConfigId, fallbackConfigId: fallback.configId })
    enqueueExecution(id, fallback, record.type as TaskType, record.model || fallback.model)
    return true
  }

  return false
}

/** 按任务 id 判定是否测试任务（调用点手上只有 id 时使用；读不到行按非测试处理） */
export async function isConfigTestTask(id: number): Promise<boolean> {
  const [row] = await db.select({ params: schema.sysTask.params }).from(schema.sysTask)
    .where(eq(schema.sysTask.id, id))
  return isConfigTestParams(parseTaskParams(row?.params))
}

export async function failTask(id: number, message: string, opts?: { abandon?: boolean }) {
  // 参考素材链接失效（轮询阶段上游判失败）：不记失败直接重排重建素材（限次防循环），不消耗重试额度；
  // 重排会重新归一化参考图（本地读取/回退落盘文件），下次提交即得新链接（见 generation-refs.ts）
  if (isAssetExpiryError(message) && await requeueExpiredAssetTask(id)) return
  logTaskError('SysTask', 'failed', { id, error: message, abandon: !!opts?.abandon })
  await db.update(schema.sysTask)
    .set({ status: 'failed', errorMsg: message, updatedAt: now(), ...(opts?.abandon ? { retryCount: ABANDONED_RETRY_COUNT } : {}) })
    .where(eq(schema.sysTask.id, id))
  // 同步场景资产状态，避免场景永远卡在 processing
  const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (row?.sceneId) {
    await db.update(schema.scenes)
      .set({ status: 'failed', updatedAt: now() })
      .where(eq(schema.scenes.id, row.sceneId))
  }
  // 绿网拦截：命中内容审核类失败时异步触发提示词自动修正重提（受项目开关控制，失败不影响落库）
  // 单次生成测试除外：自动修正会再花一次文本调用并重新提交上游，与「只测一次」相悖，失败原样回给用户
  moderationFixModule ??= import('./moderation-fix.js')
  const mod = await moderationFixModule
  if (mod.isModerationError(message) && !isConfigTestParams(parseTaskParams(row?.params))) {
    void mod.attemptModerationAutoFix(id).catch(err => {
      logTaskWarn('SysTask', 'green-net-fix-error', { id, error: err?.message || String(err) })
    })
  }
}

/**
 * 解析恢复任务的执行配置：优先匹配原任务厂商（轮询中的任务换厂商会解析失败），
 * 无匹配时回退当前启用的最高优先级配置；指定 userId 时只在归属用户的配置中选（重启恢复不跨用户）
 */
export async function resolveResumeConfig(type: TaskType, provider: string | null, userId?: number | null): Promise<AIConfig | null> {
  if (provider) {
    const rows = (await db.select().from(schema.aiServiceConfigs)
      .where(eq(schema.aiServiceConfigs.serviceType, type)))
      .filter(r => r.isActive && r.provider === provider && (userId == null || r.userId === userId))
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    const match = rows[0]
    if (match) {
      const models = match.model ? JSON.parse(match.model) : []
      return { provider: match.provider || '', baseUrl: match.baseUrl, apiKey: match.apiKey, model: models[0] || '', models: models.filter((m: any) => typeof m === 'string' && m.trim()), configId: match.id, qpm: parseConfigQpm(match.settings) }
    }
  }
  return getResumeConfig(type, userId)
}
