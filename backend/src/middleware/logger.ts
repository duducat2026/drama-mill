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

import type { MiddlewareHandler, ErrorHandler } from 'hono'

const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
}

function statusColor(status: number): string {
  if (status >= 500) return colors.red
  if (status >= 400) return colors.yellow
  if (status >= 300) return colors.cyan
  return colors.green
}

function formatTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

/** 请求体里不得进日志的凭证类字段（口令 / API Key / Token） */
const SECRET_FIELD =
  /("(?:password|oldPassword|newPassword|confirmPassword|apiKey|api_key|access_key|accessKey|secret|secretKey|token|authorization)"\s*:\s*")((?:[^"\\]|\\.)*)(")/gi

/** 脱敏：只抹掉凭证内容并换成等长星号，保留字段名与长度便于定位问题 */
export function maskSecrets(text: string): string {
  return text.replace(SECRET_FIELD, (_m, key: string, value: string, quote: string) =>
    `${key}${'*'.repeat(value.length)}${quote}`)
}

/**
 * 全局日志中间件 — 打印请求方法/路径/状态/耗时/请求体
 */
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const method = c.req.method
  const path = c.req.path
  const start = performance.now()

  // 打印请求
  const time = formatTime()
  let bodyInfo = ''
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    try {
      const clone = c.req.raw.clone()
      const text = await clone.text()
      if (text) {
        // 先脱敏再截断：避免登录/改密/模型配置的凭证明文落盘到共享日志
        const masked = maskSecrets(text)
        const truncated = masked.length > 500 ? masked.slice(0, 500) + '...' : masked
        bodyInfo = `\n  ${colors.dim}body: ${truncated}${colors.reset}`
      }
    } catch {}
  }

  console.log(`${colors.dim}${time}${colors.reset} ${colors.cyan}${method}${colors.reset} ${path}${bodyInfo}`)

  await next()

  const ms = (performance.now() - start).toFixed(0)
  const status = c.res.status
  const sc = statusColor(status)
  console.log(`${colors.dim}${time}${colors.reset} ${colors.cyan}${method}${colors.reset} ${path} ${sc}${status}${colors.reset} ${colors.dim}${ms}ms${colors.reset}`)
}

/**
 * 全局错误处理（注册为 app/api 各自的 onError 钩子）— 打印完整堆栈并统一返回 JSON。
 * 注意：Hono 子应用（api.route 挂载）内抛出的异常由子应用自身的 onError 接管，
 * 不会向上传播到父应用中间件；若不用 onError 接管，默认处理器会返回纯文本
 * "Internal Server Error"，前端 JSON.parse 直接报 Unexpected token
 */
export const errorHandler: ErrorHandler = (err: any, c) => {
  const status = err?.status || 500
  console.error(`${colors.red}[ERROR]${colors.reset} ${c.req.method} ${c.req.path}`)
  console.error(err?.stack || err?.message || err)
  return c.json({ code: status, message: err?.message || 'Internal Server Error' }, status)
}
