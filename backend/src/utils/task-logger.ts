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
 * 任务日志器 — 全后端统一的带色控制台输出
 * 约定格式：时间 [Scope] ACTION | k=v k=v；payload 打印前必须过凭证/大字段清洗，
 * 防止 API key、base64 图像之类的敏感或超大内容原样进日志（开源部署常接日志采集）。
 */

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS'

// ANSI 色码表：INFO 青色、SUCCESS 绿色、WARN 黄色、ERROR 红色，payload 单独蓝色
const ANSI: Record<LogLevel | 'dim' | 'payload' | 'reset', string> = {
  dim: '\x1b[2m', reset: '\x1b[0m',
  INFO: '\x1b[36m', SUCCESS: '\x1b[32m', WARN: '\x1b[33m', ERROR: '\x1b[31m',
  payload: '\x1b[34m',
}

const LEVEL_PREFIX: Partial<Record<LogLevel, string>> = {
  SUCCESS: 'DONE ',
  ERROR: 'ERROR ',
}

function stamp(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

/** 日志行骨架：dim 时间 + 着色 [scope] + 动作（可带前缀） + key=value 尾串 */
function emit(level: LogLevel, scope: string, action: string, meta?: Record<string, unknown>) {
  const prefix = LEVEL_PREFIX[level] ?? ''
  console.log(`${ANSI.dim}${stamp()}${ANSI.reset} ${ANSI[level]}[${scope}]${ANSI.reset} ${prefix}${action}${renderMeta(meta)}`)
}

function renderMeta(meta?: Record<string, unknown>): string {
  if (!meta) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue
    parts.push(`${key}=${stringifyValue(value)}`)
  }
  return parts.length ? ` | ${parts.join(' ')}` : ''
}

function stringifyValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// URL query 里可能藏凭证的参数名（各家服务商写法不一）
const SECRET_QUERY_KEYS = ['key', 'api_key', 'apikey', 'token', 'access_token']

/** 抹掉 URL 查询串中的凭证参数；URL 解析失败退到正则兜底（相对路径/残缺 URL） */
export function redactUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl)
    SECRET_QUERY_KEYS.forEach(k => parsed.searchParams.has(k) && parsed.searchParams.set(k, '***'))
    return parsed.toString()
  } catch {
    return rawUrl.replace(/([?&](?:key|api_key|apikey|token|access_token)=)[^&]+/gi, '$1***')
  }
}

// 命中即整值打码的字段名（精确）与关键字（子串，先转小写再比）
const MASKED_EXACT = ['authorization', 'api_key', 'apikey', 'apiKey', 'token', 'access_token']
const MASKED_HINTS = ['authorization', 'token', 'apikey', 'api_key']
// 命中即头尾截断的 base64/大载荷字段关键字
const BLOB_HINTS = ['base64', 'audiohex', 'inline']

/** 深度清洗对象：凭证字段打码、URL 字段去 key、base64 类大字段截断 */
function sanitizeValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' ? trimLong(value) : value
  }
  if (Array.isArray(value)) return value.map(sanitizeValue)

  const cleaned: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase()
    if (MASKED_EXACT.includes(key) || MASKED_EXACT.includes(lower)
      || MASKED_HINTS.some(hint => lower.includes(hint))) {
      cleaned[key] = '***'
      continue
    }
    if (typeof raw === 'string') {
      if (lower === 'url' || lower.endsWith('url')) {
        cleaned[key] = redactUrl(raw)
        continue
      }
      if (lower === 'data' || lower === 'b64_json' || raw.startsWith('data:image/')
        || BLOB_HINTS.some(hint => lower.includes(hint))) {
        cleaned[key] = trimLong(raw, 48)
        continue
      }
    }
    cleaned[key] = sanitizeValue(raw)
  }
  return cleaned
}

/** 超长字符串折中显示：保留头尾各 edge 字符，中间标注总长 */
function trimLong(value: string, edge = 120): string {
  if (value.length <= edge * 2 + 24) return value
  return `${value.slice(0, edge)}...<trimmed ${value.length} chars>...${value.slice(-edge)}`
}

export function logTask(scope: string, action: string, meta?: Record<string, unknown>, level: LogLevel = 'INFO') {
  emit(level, scope, action, meta)
}

export function logTaskStart(scope: string, action: string, meta?: Record<string, unknown>) {
  emit('INFO', scope, `START ${action}`, meta)
}

export function logTaskProgress(scope: string, action: string, meta?: Record<string, unknown>) {
  emit('INFO', scope, action, meta)
}

export function logTaskSuccess(scope: string, action: string, meta?: Record<string, unknown>) {
  emit('SUCCESS', scope, action, meta)
}

export function logTaskWarn(scope: string, action: string, meta?: Record<string, unknown>) {
  emit('WARN', scope, action, meta)
}

export function logTaskError(scope: string, action: string, meta?: Record<string, unknown>) {
  emit('ERROR', scope, action, meta)
}

/** 打印完整请求/响应载荷：先深度清洗再美化序列化 */
export function logTaskPayload(scope: string, action: string, payload: unknown) {
  const cleaned = sanitizeValue(payload)
  const text = typeof cleaned === 'string' ? cleaned : JSON.stringify(cleaned, null, 2)
  console.log(`${ANSI.dim}${stamp()}${ANSI.reset} ${ANSI.payload}[${scope}]${ANSI.reset} ${action}\n${text}`)
}
