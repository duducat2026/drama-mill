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
 * 统一响应信封：{ code, data, message }，HTTP 状态与 code 字段保持一致。
 * 前端 useApi 按该结构解包，勿随意改字段名。
 */
import type { Context } from 'hono'

/** 成功信封：始终带 data 字段 */
function ok(c: Context, code: number, message: string, data: any, httpStatus?: number) {
  const body = { code, data, message }
  return httpStatus ? c.json(body, httpStatus as any) : c.json(body)
}

/** 失败信封：只回 code+message，不带 data 键（与历史行为一致） */
function fail(c: Context, code: number, message: string) {
  return c.json({ code, message }, code as any)
}

export function success(c: Context, data: any = null) {
  return ok(c, 200, 'success', data)
}

export function created(c: Context, data: any = null) {
  return ok(c, 201, 'created', data, 201)
}

export function badRequest(c: Context, message = 'bad request') {
  return fail(c, 400, message)
}

export function notFound(c: Context, message = 'not found') {
  return fail(c, 404, message)
}

export function serverError(c: Context, message = 'internal error') {
  return fail(c, 500, message)
}

/** ISO 时间戳：落库 updatedAt/completedAt 等字段的统一来源 */
export function now() {
  return new Date().toISOString()
}
