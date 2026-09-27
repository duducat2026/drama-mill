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
 * Agent 的运行期请求上下文桥。
 *
 * 工具集是模块级单例，不能持有会话态；本文件把「这一次调用属于哪部剧/哪一集、
 * 用哪个模型配置」等信息装进 Mastra RequestContext，随 generate 调用透传，
 * 工具 execute 里再用对应 getter 取回。
 */
import { RequestContext } from '@mastra/core/request-context'

export interface AgentRequestContextValues {
  episodeId: number
  dramaId: number
  modelOverride?: string
  textConfigId?: number
  userId?: number
}

/** 路由层入口：把调用参数打包成 RequestContext（空值一律不写入） */
export function buildAgentRequestContext(values: AgentRequestContextValues): RequestContext<AgentRequestContextValues> {
  const rc = new RequestContext<AgentRequestContextValues>()
  for (const [key, value] of Object.entries(values)) {
    if (value) rc.set(key as never, value as never)
  }
  return rc
}

/** 数值键读取：缺失或类型不符统一归 null，调用方自行判空 */
function readNumeric(rc: RequestContext | undefined, key: string): number | null {
  const raw = rc?.get(key as never)
  return typeof raw === 'number' ? raw : null
}

export function getEpisodeId(requestContext: RequestContext | undefined): number | null {
  return readNumeric(requestContext, 'episodeId')
}

export function getDramaId(requestContext: RequestContext | undefined): number | null {
  return readNumeric(requestContext, 'dramaId')
}

export function getUserId(requestContext: RequestContext | undefined): number | null {
  return readNumeric(requestContext, 'userId')
}
