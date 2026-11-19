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
 * AI 配置解析层
 * 文本/图片/视频三类调用统一从这里取服务商、密钥、端点与模型清单：
 * 服务商必须命中 officialProviders 白名单，白名单外的配置一律按无效处理。
 * 用户级模型调用总开关也在此入口拦截（在途任务恢复链路除外）。
 */
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { assertAiCallEnabled } from './ai-switch.js'
import { logTaskProgress, logTaskWarn } from '../utils/task-logger.js'
import { joinProviderUrl } from './adapters/url.js'

export type ServiceType = 'text' | 'image' | 'video'

export interface AIConfig {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  /** 配置勾选的全部模型（model 字段是 JSON 数组）；多模型分流时按上游负载挑选，未设置时仅有 model */
  models?: string[]
  /** 配置 ID（网关自适应限流与成本归属依赖；重启恢复链路可能拿不到） */
  configId?: number
  /** 采样温度，null 表示不下发（跟随服务商默认）；存于 ai_service_configs.settings JSON */
  temperature?: number | null
  /** 网关限流 QPM（每分钟请求数），存于 settings JSON；缺省走全局默认间隔 */
  qpm?: number | null
}

/** settings JSON 里读一个数字项；解析失败/类型不符/非有限值统一归 null；positiveOnly 时非正数也归 null */
function pickSettingNumber(settingsRaw: string | null | undefined, key: string, positiveOnly = false): number | null {
  if (!settingsRaw) return null
  try {
    const value = JSON.parse(settingsRaw)?.[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return positiveOnly && value <= 0 ? null : value
  } catch {
    return null
  }
}

/** 从 settings JSON 解析 temperature；非法值一律视为未设置 */
export function parseConfigTemperature(settingsRaw: string | null | undefined): number | null {
  return pickSettingNumber(settingsRaw, 'temperature')
}

/** 从 settings JSON 解析 qpm（网关限流，每分钟请求数）；非法/缺失返回 null */
export function parseConfigQpm(settingsRaw: string | null | undefined): number | null {
  return pickSettingNumber(settingsRaw, 'qpm', true)
}

export const officialProviders: Record<ServiceType, readonly string[]> = {
  // 文本侧百炼走 OpenAI 兼容模式（base_url 以 compatible-mode/v1 收尾），运行时复用 createOpenAI
  // token-plan：百炼套餐订阅（Key 以 sk-sp- 开头），与按量付费同协议族、仅站点不同；
  // 套餐只开放文本与视频——图片端点仅支持同步（异步 text2image 实测 403），生图仍走按量付费 dashscope
  text: ['openai', 'gemini', 'volcengine', 'dashscope', 'token-plan', 'model-router'],
  image: ['openai', 'gemini', 'volcengine', 'dashscope', 'model-router'],
  // Model Router 网关：文本按 OpenAI Chat 兼容、图片/视频按 DashScope 兼容体（端点同在 /v1 下）
  video: ['volcengine', 'minimax', 'dashscope', 'token-plan', 'model-router'],
}

export function isOfficialProvider(serviceType?: string | null, provider?: string | null): boolean {
  const allowed = officialProviders[serviceType as ServiceType]
  if (!allowed) return false
  return allowed.includes((provider || '').toLowerCase())
}

export function getTextProviderBaseUrl(config: AIConfig) {
  const provider = config.provider.toLowerCase()

  if (provider === 'openai') {
    return joinProviderUrl(config.baseUrl, '/v1', '')
  }

  // Model Router 文本同样按 OpenAI Chat 兼容协议处理，端点挂在 /v1
  if (provider === 'model-router') {
    return joinProviderUrl(config.baseUrl, '/v1', '')
  }

  // Token Plan 套餐文本按 OpenAI Chat 兼容协议，端点挂在 /compatible-mode/v1（填站点根也自动补全）
  if (provider === 'token-plan') {
    return joinProviderUrl(config.baseUrl, '/compatible-mode/v1', '')
  }

  if (provider === 'gemini') {
    return joinProviderUrl(config.baseUrl, '/v1beta', '')
  }

  // 火山方舟文本走自家 /api/v3；其余厂商（如百炼）按 baseUrl 原样使用
  if (provider === 'volcengine') {
    return joinProviderUrl(config.baseUrl, '/api/v3', '')
  }

  return config.baseUrl
}

// Agent 多步循环会逐步重复解析同一配置，配置内容没变就只打一次日志避免刷屏
const activeConfigLogStamp = new Map<string, string>()
const configByIdLogStamp = new Map<number, string>()

/**
 * 解析文本调用的计价元数据（供成本采集）：指定 configId 优先，否则取用户启用配置；
 * 返回 provider/首个模型/配置 ID，无可用配置返回 null
 */
export async function resolveTextConfigMeta(userId?: number | null, configId?: number | null): Promise<{ configId: number | null; provider: string; model: string } | null> {
  let row = null
  if (configId) {
    const [hit] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, configId))
    // 指定配置必须归属调用者：他人的配置号不参与计价，按「未指定」处理
    // （userId 缺省的内部/历史链路不校验，避免丢记账）
    if (hit && (userId == null || hit.userId === userId)) row = hit
    else if (hit) logTaskWarn('AIConfig', 'config-ownership-denied', { configId, callerUserId: userId, ownerUserId: hit.userId })
  }
  if (!row) row = await selectActiveConfig('text', userId)
  if (!row) return null
  const models = row.model ? JSON.parse(row.model) : []
  return { configId: row.id, provider: row.provider || '', model: models[0] || '' }
}

/** 按用户维度取启用配置：指定 userId 时只在该用户的配置中选；
 *  未指定 userId 时默认不匹配任何配置（用户侧绝不回退到他人配置），
 *  只有「在途任务恢复」这类显式 allowAllUsers 的内部链路才退回全量选择 */
async function selectActiveConfig(serviceType: ServiceType, userId?: number | null, allowAllUsers = false) {
  const rows = await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, serviceType))
  const usable = rows.filter(r =>
    r.isActive
    && isOfficialProvider(serviceType, r.provider)
    && (userId != null ? r.userId === userId : allowAllUsers))
  if (!usable.length) return null
  // priority 数值大的排前面
  usable.sort((a, b) => (b.priority || 0) - (a.priority || 0))
  return usable[0]
}

export async function getActiveConfig(serviceType: ServiceType, userId?: number | null): Promise<AIConfig | null> {
  // 模型调用总开关（用户侧）：关闭时直接拒绝，不解析任何配置（文本/图片/视频共用本入口）
  await assertAiCallEnabled(userId)
  // 用户侧必须有归属人：无 userId 时一律不解析配置，绝不回退到他人配置
  if (userId == null) {
    logTaskWarn('AIConfig', 'active-config-no-user', { serviceType })
    return null
  }
  return loadActiveConfig(serviceType, userId)
}

/**
 * 在途任务恢复专用配置解析：不过模型调用开关。
 * 开关只拦「新发起」的调用；已提交上游、正在轮询/续跑的任务要继续取回结果，
 * 拦住它们会把已计费的在途任务白白判失败。
 * 历史任务可能没有 user_id，只有本链路允许退回全量选择；其它入口一律要求归属人。
 */
export async function getResumeConfig(serviceType: ServiceType, userId?: number | null): Promise<AIConfig | null> {
  return loadActiveConfig(serviceType, userId)
}

/**
 * 内部解析：userId 有值时只命中本人配置；无 userId 时按「在途恢复」语义全量兜底。
 * 用户侧入口 getActiveConfig 已在 userId 缺失时直接返回 null，不会走到兜底分支。
 */
async function loadActiveConfig(serviceType: ServiceType, userId?: number | null): Promise<AIConfig | null> {
  const active = await selectActiveConfig(serviceType, userId, true)
  if (!active) {
    logTaskWarn('AIConfig', 'active-config-missing', { serviceType, userId })
    return null
  }
  const config = toAIConfig(active)
  const stamp = `${active.id}:${config.model}`
  if (activeConfigLogStamp.get(serviceType) !== stamp) {
    activeConfigLogStamp.set(serviceType, stamp)
    logTaskProgress('AIConfig', 'active-config-selected', {
      serviceType,
      configId: active.id,
      provider: active.provider,
      model: config.model,
      priority: active.priority,
    })
  }
  return config
}

export async function getTextConfig(userId?: number | null): Promise<AIConfig> {
  const config = await getActiveConfig('text', userId)
  if (!config) throw new Error('未配置文本模型，请先到「设置」页添加并启用 AI 服务')
  return config
}

/**
 * 取某服务类型当前启用且优先级最高的官方配置 ID（创建集时自动锁定用）
 */
export async function getActiveConfigId(serviceType: ServiceType, userId?: number | null): Promise<number | null> {
  const row = await selectActiveConfig(serviceType, userId)
  return row ? row.id : null
}

/** ai_service_configs 行 → AIConfig（models 首位为默认模型） */
function toAIConfig(row: typeof schema.aiServiceConfigs.$inferSelect): AIConfig {
  const models = row.model ? JSON.parse(row.model) : []
  return {
    provider: row.provider || '',
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    model: models[0] || '',
    models: models.filter((m: any) => typeof m === 'string' && m.trim()),
    configId: row.id,
    temperature: parseConfigTemperature(row.settings),
    qpm: parseConfigQpm(row.settings),
  }
}

/** 锁定配置归属校验：userId 缺省（内部链路）跳过；配置不存在或归属他人返回 false */
export async function isConfigOwnedBy(configId: number, userId?: number | null): Promise<boolean> {
  if (userId == null) return true
  const [row] = await db.select({ userId: schema.aiServiceConfigs.userId })
    .from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, configId))
  return !!row && row.userId === userId
}

export async function getConfigById(id: number, callerUserId?: number | null): Promise<AIConfig | null> {
  const [row] = await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, id))
  if (!row || !row.isActive) {
    logTaskWarn('AIConfig', 'config-by-id-missing', { configId: id })
    return null
  }
  // 集锁定的配置同样过用户总开关：按配置归属人判定，关闭时拒绝发起调用
  await assertAiCallEnabled(row.userId)
  // 调用者只能使用自己的配置（callerUserId 缺省的内部/恢复链路不校验）
  if (callerUserId != null && row.userId !== callerUserId) {
    logTaskWarn('AIConfig', 'config-ownership-denied', { configId: id, callerUserId, ownerUserId: row.userId })
    return null
  }
  if (!isOfficialProvider(row.serviceType as ServiceType, row.provider)) {
    logTaskWarn('AIConfig', 'config-by-id-unsupported-provider', {
      configId: id,
      serviceType: row.serviceType,
      provider: row.provider,
    })
    return null
  }
  const config = toAIConfig(row)
  const stamp = `${row.provider}:${config.model}:${row.serviceType}`
  if (configByIdLogStamp.get(id) !== stamp) {
    configByIdLogStamp.set(id, stamp)
    logTaskProgress('AIConfig', 'config-by-id-selected', {
      configId: id,
      provider: row.provider,
      model: config.model,
      serviceType: row.serviceType,
    })
  }
  return config
}

/**
 * 在途任务恢复专用：按落库的 configId 精确取配置，不过模型调用总开关（只取结果，不算新发起调用）。
 * 生成测试等「锁定本配置」的任务重启后必须回到原配置继续轮询，
 * 走 getResumeConfig 的「同厂商按优先级宽松解析」会把结果记到另一份配置上。
 */
export async function getResumeConfigById(id: number): Promise<AIConfig | null> {
  const [row] = await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, id))
  if (!row || !row.isActive) {
    logTaskWarn('AIConfig', 'resume-config-by-id-missing', { configId: id })
    return null
  }
  if (!isOfficialProvider(row.serviceType as ServiceType, row.provider)) {
    logTaskWarn('AIConfig', 'resume-config-by-id-unsupported-provider', {
      configId: id,
      serviceType: row.serviceType,
      provider: row.provider,
    })
    return null
  }
  return toAIConfig(row)
}
