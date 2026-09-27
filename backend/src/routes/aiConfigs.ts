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
 * AI 服务配置管理：CRUD + 连通性探测(/test) + 极简生成测试(/:id/generate-test)
 * 配置按 user_id 行级隔离，越权一律按不存在处理（notFound，不泄露存在性）
 * generate-test 失败也回 200 + ok:false 的结构化诊断，黑盒 err.message 查不出根因
 */
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, notFound, created, badRequest, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { isOfficialProvider } from '../services/ai.js'
import { runTextGenerationTest, submitMediaGenerationTest } from '../services/ai-test.js'
import { describeFailure } from '../services/failure-detail.js'
import { maskApiKey } from '../services/cloud-tasks.js'
import { logTaskError, logTaskProgress, logTaskSuccess, redactUrl } from '../utils/task-logger.js'
import { normalizeTemperature, parseModelList, withParsedFields, bearerHeaders, geminiHeaders, buildProbe } from './ai-config-probe.js'

const app = new Hono()

/** 取自己名下的配置行；查不到或属主不符返回 null（调用侧统一 404） */
async function findOwnConfig(id: number, userId: number) {
  const [row] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  if (!row || row.userId !== userId) return null
  return row
}

// GET /ai-configs — 我的配置列表，可按 service_type 过滤
app.get('/', async (c) => {
  const user = c.get('user')
  const serviceType = c.req.query('service_type')
  let rows = (await db.select().from(schema.aiServiceConfigs))
    .filter(r => r.userId === user.id)
  if (serviceType) rows = rows.filter(r => r.serviceType === serviceType)

  return success(c, rows.map(withParsedFields))
})

// POST /ai-configs — 新建配置（provider 必须在官方白名单内）
app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const ts = now()

  if (!body.service_type || !body.provider) {
    return badRequest(c, 'service_type and provider are required')
  }
  if (!isOfficialProvider(body.service_type, body.provider)) {
    return badRequest(c, 'Unsupported service_type/provider')
  }

  let temperature: number | null = null
  if ('temperature' in body) {
    try {
      temperature = normalizeTemperature(body.temperature)
    } catch {
      return badRequest(c, 'temperature must be a number between 0 and 2')
    }
  }

  const res = await db.insert(schema.aiServiceConfigs).values({
    settings: temperature !== null ? JSON.stringify({ temperature }) : null,
    userId: user.id,
    createdAt: ts,
    updatedAt: ts,
    isActive: true,
    priority: body.priority || 0,
    model: JSON.stringify(body.model || []),
    apiKey: body.api_key || '',
    baseUrl: body.base_url || '',
    name: body.name || `${body.provider}-${body.service_type}`,
    provider: body.provider,
    serviceType: body.service_type,
  })

  const [row] = await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, getInsertId(res)))

  return created(c, withParsedFields(row))
})

// 空体探测里属于"参数没带"的报错：鉴权与路径都已通过，判连通而不算失败
const PARAM_REJECTED = /BadRequest\.Empty(Model|Parameter|Input)|Required parameter|missing from request|invalid model format|invalid_request_error/i
const REACHABLE_STATUS = [200, 204, 400, 401, 403]

function probeMessage(reachable: boolean, ok: boolean, httpOk: boolean) {
  if (!reachable) return '端点未按预期响应，请检查 Base URL 和代理前缀'
  if (ok) return httpOk ? '端点可访问，认证与路径基本正常' : '端点可访问，认证已通过（空体探测触发参数校验，属预期）'
  return '端点已响应，请根据状态码判断认证或路径是否正确'
}

// POST /ai-configs/test — 连通性探测：不发真实生成参数，只看端点/鉴权
app.post('/test', async (c) => {
  const body = await c.req.json()
  if (!body.service_type || !body.provider || !body.base_url) {
    return badRequest(c, 'service_type, provider and base_url are required')
  }
  if (!isOfficialProvider(body.service_type, body.provider)) {
    return badRequest(c, 'Unsupported service_type/provider')
  }

  const model = Array.isArray(body.model) ? body.model[0] : body.model
  const probe = buildProbe(body.service_type, body.provider, body.base_url, model, body.api_key)
  const probeUrl = redactUrl(probe.url)

  logTaskProgress('AIConfig', 'probe-start', {
    url: probeUrl, method: probe.method, provider: body.provider, serviceType: body.service_type,
  })

  try {
    const resp = await fetch(probe.url, {
      method: probe.method,
      headers: probe.headers,
      body: probe.body ? JSON.stringify(probe.body) : undefined,
    })
    const text = await resp.text()
    const reachable = REACHABLE_STATUS.includes(resp.status)
    const paramValidationError = resp.status === 400 && PARAM_REJECTED.test(text)
    const ok = resp.ok || paramValidationError
    const payload = {
      ok,
      reachable,
      status: resp.status,
      status_text: resp.statusText,
      method: probe.method,
      url: probeUrl,
      message: probeMessage(reachable, ok, resp.ok),
      response_preview: text.slice(0, 240),
    }
    if (reachable) {
      logTaskSuccess('AIConfig', 'probe-done', { url: probeUrl, status: resp.status, provider: body.provider })
    } else {
      logTaskError('AIConfig', 'probe-unexpected', { url: probeUrl, status: resp.status, provider: body.provider })
    }
    return success(c, payload)
  } catch (error: any) {
    logTaskError('AIConfig', 'probe-failed', { error: error.message, url: probeUrl, provider: body.provider })
    return success(c, {
      ok: false,
      reachable: false,
      method: probe.method,
      url: probeUrl,
      message: error.message || '请求失败',
      response_preview: '',
    })
  }
})

// POST /ai-configs/:id/generate-test — 真发一枪：文本同步回文，图片/视频回 task_id 供轮询
app.post('/:id/generate-test', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  if (!row || row.userId !== user.id) return notFound(c)
  const started = Date.now()
  try {
    if (row.serviceType === 'text') return success(c, { ok: true, ...await runTextGenerationTest(id, user.id) })
    if (row.serviceType === 'image' || row.serviceType === 'video') {
      return success(c, { ok: true, ...await submitMediaGenerationTest(row.serviceType, id, user.id) })
    }
    return badRequest(c, '该服务类型不支持生成测试')
  } catch (error: any) {
    const detail = describeFailure(error, { serviceType: row.serviceType, provider: row.provider })
    logTaskError('AIConfig', 'generate-test-failed', {
      error: detail.raw.slice(0, 300),
      requestId: detail.request_id,
      upstreamStatus: detail.upstream_status,
      kind: detail.kind,
      provider: row.provider,
      serviceType: row.serviceType,
      configId: id,
    })
    return success(c, {
      ok: false,
      service_type: row.serviceType,
      config_id: id,
      provider: row.provider || '',
      model: parseModelList(row.model)[0] || '',
      elapsed_ms: Date.now() - started,
      // 配置上下文与任务诊断接口同形：用户要能核对「这次到底拿哪个 Key 打了哪个地址」，密钥只回掩码
      config: {
        id,
        name: row.name || '',
        provider: row.provider || '',
        service_type: row.serviceType,
        base_url: row.baseUrl || '',
        api_key: maskApiKey(row.apiKey),
        is_active: !!row.isActive,
        missing: false,
      },
      task_id: null,
      error: detail,
    })
  }
})

// GET /ai-configs/:id
app.get('/:id', async (c) => {
  const user = c.get('user')
  const row = await findOwnConfig(Number(c.req.param('id')), user.id)
  if (!row) return notFound(c)
  return success(c, withParsedFields(row))
})

// PUT /ai-configs/:id — 增量更新；service_type/provider 合并现值后仍需过白名单
const PUT_FIELD_MAP: Record<string, string> = {
  name: 'name',
  base_url: 'baseUrl',
  api_key: 'apiKey',
  priority: 'priority',
  is_active: 'isActive',
}

app.put('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const existing = await findOwnConfig(id, user.id)
  if (!existing) return notFound(c)

  const serviceType = 'service_type' in body ? body.service_type : existing.serviceType
  const provider = 'provider' in body ? body.provider : existing.provider
  if (!isOfficialProvider(serviceType, provider)) {
    return badRequest(c, 'Unsupported service_type/provider')
  }

  const updates: Record<string, any> = { updatedAt: now() }
  // 服务类型与供应商显式落键（与上方白名单校验同源），其余字段走映射表
  if ('service_type' in body) updates.serviceType = body.service_type
  if ('provider' in body) updates.provider = body.provider
  for (const [snake, camel] of Object.entries(PUT_FIELD_MAP)) {
    if (snake in body) updates[camel] = body[snake]
  }
  if ('model' in body) updates.model = JSON.stringify(body.model)
  if ('temperature' in body) {
    let temperature: number | null
    try {
      temperature = normalizeTemperature(body.temperature)
    } catch {
      return badRequest(c, 'temperature must be a number between 0 and 2')
    }
    // 与已有 settings 合并，清空的 temperature 从 JSON 中移除
    let settings: Record<string, any> = {}
    try { settings = existing.settings ? JSON.parse(existing.settings) : {} } catch { settings = {} }
    if (temperature === null) delete settings.temperature
    else settings.temperature = temperature
    updates.settings = Object.keys(settings).length ? JSON.stringify(settings) : null
  }

  await db.update(schema.aiServiceConfigs).set(updates).where(eq(schema.aiServiceConfigs.id, id))
  return success(c)
})

// DELETE /ai-configs/:id — 物理删行
app.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  if (!await findOwnConfig(id, user.id)) return notFound(c)
  await db.delete(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  return success(c)
})

// GET /ai-providers — 供应商目录（预置模型 JSON 展开后给前端）
export const aiProviders = new Hono()
aiProviders.get('/', async (c) => {
  const rows = await db.select().from(schema.aiServiceProviders)
  const parsed = rows.map(r => ({
    ...toSnakeCase(r),
    preset_models: r.presetModels ? JSON.parse(r.presetModels) : [],
  }))
  return success(c, parsed)
})

export default app
