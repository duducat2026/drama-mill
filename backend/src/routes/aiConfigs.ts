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

app.get('/', async (c) => {
  const user = c.get('user')
  const serviceType = c.req.query('service_type')
  let rows = (await db.select().from(schema.aiServiceConfigs))
    .filter(r => r.userId === user.id)
  if (serviceType) rows = rows.filter(r => r.serviceType === serviceType)

  const parsed = rows.map(withParsedFields)
  return success(c, parsed)
})

// POST /ai-configs
app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const ts = now()

  // 验证必填字段
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
    serviceType: body.service_type,
    provider: body.provider,
    name: body.name || `${body.provider}-${body.service_type}`,
    baseUrl: body.base_url || '',
    apiKey: body.api_key || '',
    model: JSON.stringify(body.model || []),
    priority: body.priority || 0,
    isActive: true,
    settings: temperature !== null ? JSON.stringify({ temperature }) : null,
    userId: user.id,
    createdAt: ts,
    updatedAt: ts,
  })

  const [row] = await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, getInsertId(res)))

  return created(c, withParsedFields(row))
})

// POST /ai-configs/test
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
    serviceType: body.service_type,
    provider: body.provider,
    method: probe.method,
    url: probeUrl,
  })

  try {
    const resp = await fetch(probe.url, {
      method: probe.method,
      headers: probe.headers,
      body: probe.body ? JSON.stringify(probe.body) : undefined,
    })
    const text = await resp.text()
    const reachable = [200, 204, 400, 401, 403].includes(resp.status)
    // 空体探测的参数校验类报错（如百炼 BadRequest.EmptyModel、Model Router 的 invalid model format）：
    // 鉴权已通过、端点正确，视为连通成功，避免误报失败；真实请求参数由实际生成时携带。
    const paramValidationError =
      resp.status === 400 && /BadRequest\.Empty(Model|Parameter|Input)|Required parameter|missing from request|invalid model format|invalid_request_error/i.test(text)
    const ok = resp.ok || paramValidationError
    const payload = {
      ok,
      reachable,
      status: resp.status,
      status_text: resp.statusText,
      method: probe.method,
      url: probeUrl,
      message: reachable
        ? (ok
          ? (resp.ok ? '端点可访问，认证与路径基本正常' : '端点可访问，认证已通过（空体探测触发参数校验，属预期）')
          : '端点已响应，请根据状态码判断认证或路径是否正确')
        : '端点未按预期响应，请检查 Base URL 和代理前缀',
      response_preview: text.slice(0, 240),
    }
    if (reachable) {
      logTaskSuccess('AIConfig', 'probe-done', {
        provider: body.provider,
        status: resp.status,
        url: probeUrl,
      })
    } else {
      logTaskError('AIConfig', 'probe-unexpected', {
        provider: body.provider,
        status: resp.status,
        url: probeUrl,
      })
    }
    return success(c, payload)
  } catch (error: any) {
    logTaskError('AIConfig', 'probe-failed', {
      provider: body.provider,
      url: probeUrl,
      error: error.message,
    })
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

// POST /ai-configs/:id/generate-test — 极简生成测试（文本同步回传结果；图片/视频提交任务返回 task_id 供轮询）
// 失败按 200 + ok:false 回传结构化诊断（与「测试配置」探测同形）：只透一句 err.message
// 会出现「生成失败」这类查不出原因的黑盒提示，上游状态码/错误码/request_id 都在包装层里。
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
      configId: id,
      serviceType: row.serviceType,
      provider: row.provider,
      kind: detail.kind,
      upstreamStatus: detail.upstream_status,
      requestId: detail.request_id,
      error: detail.raw.slice(0, 300),
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
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  if (!row || row.userId !== user.id) return notFound(c)
  return success(c, withParsedFields(row))
})

// PUT /ai-configs/:id
app.put('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [existing] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  if (!existing || existing.userId !== user.id) return notFound(c)

  const serviceType = 'service_type' in body ? body.service_type : existing.serviceType
  const provider = 'provider' in body ? body.provider : existing.provider
  if (!isOfficialProvider(serviceType, provider)) {
    return badRequest(c, 'Unsupported service_type/provider')
  }

  const updates: Record<string, any> = { updatedAt: now() }

  if ('service_type' in body) updates.serviceType = body.service_type
  if ('provider' in body) updates.provider = body.provider
  if ('name' in body) updates.name = body.name
  if ('base_url' in body) updates.baseUrl = body.base_url
  if ('api_key' in body) updates.apiKey = body.api_key
  if ('model' in body) updates.model = JSON.stringify(body.model)
  if ('priority' in body) updates.priority = body.priority
  if ('is_active' in body) updates.isActive = body.is_active
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

// DELETE /ai-configs/:id
app.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  if (!row || row.userId !== user.id) return notFound(c)
  await db.delete(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  return success(c)
})

// GET /ai-providers
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
