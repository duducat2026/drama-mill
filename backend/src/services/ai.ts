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
 * AI 服务抽象层 — 从数据库配置中获取 provider 和 API key
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
  /** 配置内全部模型（model 字段 JSON 数组）；多模型分流时按上游负载选模型，缺省仅 model 单模型 */
  models?: string[]
  /** 配置 ID（限流按网关自适应/成本归属用；重启恢复链路可能缺失） */
  configId?: number
  /** 采样温度，null 表示不设置（跟随服务商默认）。存于 ai_service_configs.settings JSON */
  temperature?: number | null
  /** 网关限流 QPM（每分钟请求数），存于 settings JSON；缺省用全局默认间隔 */
  qpm?: number | null
}

/** 从 settings JSON 解析 temperature；非法值一律视为未设置 */
export function parseConfigTemperature(settingsRaw: string | null | undefined): number | null {
  if (!settingsRaw) return null
  try {
    const t = JSON.parse(settingsRaw)?.temperature
    return typeof t === 'number' && Number.isFinite(t) ? t : null
  } catch {
    return null
  }
}

/** 从 settings JSON 解析 qpm（网关限流，每分钟请求数）；非法/缺失返回 null */
export function parseConfigQpm(settingsRaw: string | null | undefined): number | null {
  if (!settingsRaw) return null
  try {
    const q = JSON.parse(settingsRaw)?.qpm
    return typeof q === 'number' && Number.isFinite(q) && q > 0 ? q : null
  } catch {
    return null
  }
}

export const officialProviders: Record<ServiceType, readonly string[]> = {
  // 文本新增百炼：走 OpenAI 兼容模式（base_url 以 compatible-mode/v1 结尾），运行时复用 createOpenAI
  text: ['openai', 'gemini', 'volcengine', 'dashscope', 'model-router'],
  image: ['openai', 'gemini', 'volcengine', 'dashscope', 'model-router'],
  // Model Router 网关：文本走 OpenAI Chat 兼容，图片/视频走 DashScope 兼容体（端点在 /v1 下）
  video: ['volcengine', 'minimax', 'dashscope', 'model-router'],
}

export function isOfficialProvider(serviceType?: string | null, provider?: string | null): boolean {
  const providers = officialProviders[serviceType as ServiceType]
  return !!providers && providers.includes((provider || '').toLowerCase())
}

export function getTextProviderBaseUrl(config: AIConfig) {
  const provider = config.provider.toLowerCase()

  if (provider === 'openai') {
    return joinProviderUrl(config.baseUrl, '/v1', '')
  }

  // Model Router 文本走 OpenAI Chat 兼容协议，端点同样挂在 /v1 下
  if (provider === 'model-router') {
    return joinProviderUrl(config.baseUrl, '/v1', '')
  }

  if (provider === 'gemini') {
    return joinProviderUrl(config.baseUrl, '/v1beta', '')
  }

  if (provider === 'volcengine') {
    return joinProviderUrl(config.baseUrl, '/api/v3', '')
  }

  return config.baseUrl
}

// Agent 多步循环会逐步重复解析同一配置，相同配置只打一次日志避免刷屏
const lastLoggedActiveConfigKey = new Map<string, string>()
const lastLoggedConfigByIdKey = new Map<number, string>()

/**
 * 解析文本调用的计价元数据（供成本采集）：指定 configId 优先，否则取用户启用配置；
 * 返回 provider/首个模型/配置 ID，无可用配置返回 null
 */
export async function resolveTextConfigMeta(userId?: number | null, configId?: number | null): Promise<{ configId: number | null; provider: string; model: string } | null> {
  let row = null
  if (configId) {
    const [r] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, configId))
    row = r || null
  }
  if (!row) row = await selectActiveConfig('text', userId)
  if (!row) return null
  const models = row.model ? JSON.parse(row.model) : []
  return { configId: row.id, provider: row.provider || '', model: models[0] || '' }
}

/** 按用户维度取启用配置：指定 userId 时只在该用户的配置中选；未指定（历史任务/管理链路）退回全量 */
async function selectActiveConfig(serviceType: ServiceType, userId?: number | null) {
  const rows = (await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, serviceType))
  )
    .filter(r => r.isActive && isOfficialProvider(serviceType, r.provider) && (userId == null || r.userId === userId))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0)) // 高优先级优先
  return rows[0] ?? null
}

export async function getActiveConfig(serviceType: ServiceType, userId?: number | null): Promise<AIConfig | null> {
  // 模型调用总开关（用户侧）：关闭时直接拒绝，不解析任何配置（文本/图片/视频共用本入口）
  await assertAiCallEnabled(userId)
  return loadActiveConfig(serviceType, userId)
}

/**
 * 在途任务恢复专用配置解析：不过模型调用开关。
 * 开关只拦「新发起」的调用；已提交上游、正在轮询/续跑的任务要继续取回结果，
 * 拦住它们会把已计费的在途任务白白判失败。
 */
export async function getResumeConfig(serviceType: ServiceType, userId?: number | null): Promise<AIConfig | null> {
  return loadActiveConfig(serviceType, userId)
}

async function loadActiveConfig(serviceType: ServiceType, userId?: number | null): Promise<AIConfig | null> {
  const active = await selectActiveConfig(serviceType, userId)
  if (!active) {
    logTaskWarn('AIConfig', 'active-config-missing', { serviceType, userId })
    return null
  }

  const models = active.model ? JSON.parse(active.model) : []
  const logKey = `${active.id}:${models[0] || ''}`
  if (lastLoggedActiveConfigKey.get(serviceType) !== logKey) {
    lastLoggedActiveConfigKey.set(serviceType, logKey)
    logTaskProgress('AIConfig', 'active-config-selected', {
      serviceType,
      configId: active.id,
      provider: active.provider,
      model: models[0] || '',
      priority: active.priority,
    })
  }
  return {
    provider: active.provider || '',
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    model: models[0] || '',
    models: models.filter((m: any) => typeof m === 'string' && m.trim()),
    configId: active.id,
    temperature: parseConfigTemperature(active.settings),
    qpm: parseConfigQpm(active.settings),
  }
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
  return row?.id ?? null
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

export async function getConfigById(id: number): Promise<AIConfig | null> {
  const [row] = await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, id))
  if (!row || !row.isActive) {
    logTaskWarn('AIConfig', 'config-by-id-missing', { configId: id })
    return null
  }
  // 集锁定的配置同样过用户总开关：按配置归属人判定，关闭时拒绝发起调用
  await assertAiCallEnabled(row.userId)
  if (!isOfficialProvider(row.serviceType as ServiceType, row.provider)) {
    logTaskWarn('AIConfig', 'config-by-id-unsupported-provider', {
      configId: id,
      serviceType: row.serviceType,
      provider: row.provider,
    })
    return null
  }
  const models = row.model ? JSON.parse(row.model) : []
  const logKey = `${row.provider}:${models[0] || ''}:${row.serviceType}`
  if (lastLoggedConfigByIdKey.get(id) !== logKey) {
    lastLoggedConfigByIdKey.set(id, logKey)
    logTaskProgress('AIConfig', 'config-by-id-selected', {
      configId: id,
      provider: row.provider,
      model: models[0] || '',
      serviceType: row.serviceType,
    })
  }
  return toAIConfig(row)
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
