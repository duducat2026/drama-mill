/*
 * Drama Mill — AI 配置探测辅助：连接测试请求构建 + 字段解析工具
 */
import { joinProviderUrl } from '../services/adapters/url.js'
import { isOfficialProvider, parseConfigTemperature } from '../services/ai.js'
import { toSnakeCase } from '../utils/transform.js'

export function normalizeTemperature(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 2) throw new Error('invalid temperature')
  return n
}

/** 模型列存 JSON 数组字符串，历史脏数据/手工改库都可能不是合法 JSON —— 解析失败按空列表处理，不让列表页 500 */
export function parseModelList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.map(String) : []
  } catch {
    return []
  }
}

/** 把 settings JSON 中的 temperature 透出为顶层字段，便于前端直接读写 */
export function withParsedFields(r: any) {
  return {
    ...toSnakeCase(r),
    model: parseModelList(r.model),
    temperature: parseConfigTemperature(r.settings),
  }
}

export function bearerHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

export function geminiHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) {
    headers['x-goog-api-key'] = apiKey
  }
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

export function buildProbe(serviceType: string, provider: string, baseUrl: string, model?: string, apiKey?: string) {
  const p = provider.toLowerCase()
  const m = model || ''

  if (p === 'gemini') {
    // 探针统一走 generateContent:文本运行时(AI SDK)走的就是它,官方与中转站都支持;
    // interactions 端点很多中转站未配置,探它会误报 500。
    // 用最小合法请求体而非空体——空体在部分中转站会触发上游认证失败的误报
    const modelName = m || 'gemini-3.1-pro-preview'
    const url = new URL(joinProviderUrl(baseUrl, '/v1beta', `/models/${modelName}:generateContent`))
    if (apiKey) url.searchParams.set('key', apiKey)
    return {
      method: 'POST',
      url: url.toString(),
      headers: geminiHeaders(apiKey, true),
      body: { contents: [{ parts: [{ text: 'hi' }] }] },
    }
  }

  if (p === 'openai' || p === 'model-router') {
    // 探测直接打真实生成端点并送空体：只验鉴权与路径，不产出内容。
    // 早期实现探测 GET /v1/models，但「只实现生成接口、未实现模型列表」的合规网关（实测 Model Router）
    // 会恒定回 404，被误判成「端点未按预期响应」，与生成测试能成功自相矛盾。
    const path = serviceType === 'image'
      ? '/images/generations'
      : serviceType === 'video'
        ? '/videos/generations'
        : '/chat/completions'
    const headers = bearerHeaders(apiKey, true)
    // 该网关视频要求异步头，缺了会被判成同步调用而报参数错
    if (p === 'model-router' && serviceType === 'video') headers['X-MR-Async'] = 'true'
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/v1', path),
      headers,
      body: {},
    }
  }

  if (p === 'volcengine') {
    const path = serviceType === 'video'
      ? '/contents/generations/tasks'
      : serviceType === 'text'
        ? '/chat/completions'
        : '/images/generations'
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/api/v3', path),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (p === 'minimax') {
    // MiniMax 仅提供视频服务，空请求体探测鉴权/端点连通性
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/v2', '/video_generation'),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (p === 'dashscope') {
    // 百炼文本走 OpenAI 兼容模式（base_url 以 compatible-mode/v1 结尾），GET /models 探测连通性
    if (serviceType === 'text') {
      return {
        method: 'GET',
        url: joinProviderUrl(baseUrl, '', '/models'),
        headers: bearerHeaders(apiKey),
        body: undefined,
      }
    }
    // 百炼 DashScope：图片走多模态统一端点（同步），视频走异步任务 API，空请求体探测鉴权/端点连通性
    if (serviceType === 'video') {
      return {
        method: 'POST',
        url: joinProviderUrl(baseUrl, '/api/v1', '/services/aigc/video-generation/video-synthesis'),
        headers: {
          ...bearerHeaders(apiKey, true),
          'X-DashScope-Async': 'enable',
        },
        body: {},
      }
    }
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/api/v1', '/services/aigc/multimodal-generation/generation'),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  return {
    method: 'GET',
    url: joinProviderUrl(baseUrl, '', m ? `/${m}` : '/'),
    headers: bearerHeaders(apiKey),
    body: undefined,
  }
}

// GET /ai-configs?service_type=text（仅当前用户的配置）
