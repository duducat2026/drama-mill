/**
 * Drama Mill — AI 短剧生成平台
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
/*
 * Drama Mill — 失败诊断：原始错误的解析 / 去密 / 截断纯工具（不做规则判定）
 */

/** 原始信息展示上限：够装下完整 JSON 错误体，又不至于把弹层撑爆 */
const RAW_LIMIT = 1500

/** 从错误对象上可能捞到真实原因的字段（不同 SDK / 包装层各放一处） */
export function candidates(err: any): { parts: string[]; code: string } {
  const parts: string[] = []
  // Error 实例 JSON.stringify 会得到 '{}'，混进文本里会把后面的 JSON 提取带偏，单独取字段
  const push = (v: unknown) => {
    if (typeof v === 'string' || typeof v === 'number') {
      const s = String(v).trim()
      if (s) parts.push(s)
    } else if (v && typeof v === 'object' && !(v instanceof Error)) {
      try { parts.push(JSON.stringify(v)) } catch { /* 循环引用忽略 */ }
    }
  }
  let cur = err
  let code = ''
  for (let depth = 0; cur && depth < 5; depth++) {
    push(cur.name && cur.message ? `${cur.name}: ${cur.message}` : cur.message)
    push(cur.error?.message ?? cur.error)      // 上游 { error: {...} } 体
    push(cur.responseBody ?? cur.body ?? cur.text ?? cur.data)
    if (!code && typeof cur.code === 'string' && cur.code) code = cur.code
    cur = cur.cause ?? cur.error               // 沿 cause / error 继续下钻
  }
  return { parts, code }
}

/** 状态码：优先错误对象上的字段，其次从文本里认（如 "API error 401: ..."） */
export function pickStatus(err: any, text: string): number | null {
  for (const v of [err?.statusCode, err?.status, err?.response?.status]) {
    if (typeof v === 'number' && v >= 100 && v <= 599) return v
  }
  const m = text.match(/\b(?:api error|http|status(?:\s*code)?|code)\D{0,4}(\d{3})\b/i)
    || text.match(/^(?:error\s*)?(4\d\d|5\d\d)\b/i)
  const code = m ? Number(m[1]) : NaN
  return code >= 100 && code <= 599 ? code : null
}

/** 逐段尝试解析 JSON 错误体，取上游错误码与 request_id（整段拼接再解析会被 HTML/前后缀带崩） */
export function pickBodyFields(parts: string[]): { code: string; requestId: string; message: string } {
  const result = { code: '', requestId: '', message: '' }
  for (const part of parts) {
    const start = part.indexOf('{')
    const end = part.lastIndexOf('}')
    if (start < 0 || end <= start) continue
    let j: any
    try { j = JSON.parse(part.slice(start, end + 1)) } catch { continue }
    if (!j || typeof j !== 'object') continue
    if (!result.code) result.code = String(j?.error?.code || j?.error?.type || j?.code || j?.err_code || '').slice(0, 80)
    if (!result.requestId) result.requestId = String(j?.request_id || j?.requestId || j?.rid || j?.error?.request_id || '').slice(0, 80)
    if (!result.message) result.message = String(j?.error?.message || j?.message || '').slice(0, 400)
    if (result.code && result.requestId && result.message) break
  }
  return result
}

/** 去掉可能混入错误信息的密钥（上游偶尔把请求头回显在错误体里） */
export function redact(text: string): string {
  return text
    .replace(/((?:api[_-]?key|access[_-]?key|token|secret)\s*[=:]\s*)[^\s,;}&]+/gi, '$1***')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-***')
    .replace(/([?&](?:key|api_key|apikey|token|access_token)=)[^&\s]+/gi, '$1***')
}

export function truncate(text: string): string {
  return text.length > RAW_LIMIT ? `${text.slice(0, RAW_LIMIT)}\n…（已截断，完整内容见后端日志）` : text
}
