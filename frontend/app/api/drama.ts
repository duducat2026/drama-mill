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

// 项目 / 剧集 / 分镜 / 剧本改写 API（经门面 ~/composables/useApi 汇总导出）
import { api } from './core'

export const dramaAPI = {
  // 项目列表：真实分页（后端 COUNT 聚合 + LIMIT/OFFSET），返回 { items, pagination }
  list: (params?: { page?: number; page_size?: number; status?: string; keyword?: string }) => {
    const query = new URLSearchParams()
    if (params?.page) query.set('page', String(params.page))
    if (params?.page_size) query.set('page_size', String(params.page_size))
    if (params?.status) query.set('status', params.status)
    if (params?.keyword) query.set('keyword', params.keyword)
    return api.get<{ items: any[]; pagination: { page: number; page_size: number; total: number; total_pages: number } }>(`/dramas${query.size ? `?${query.toString()}` : ''}`)
  },
  get: (id: number, opts?: { summary?: boolean }) => api.get(`/dramas/${id}${opts?.summary ? '?summary=1' : ''}`),
  // 轻量素材图片状态（供素材生图轮询，替代全量项目树）
  assetsStatus: (id: number) => api.get<{ characters: any[]; scenes: any[]; props: any[] }>(`/dramas/${id}/assets-status`),
  create: (data: any) => api.post('/dramas', data),
  update: (id: number, data: any) => api.put(`/dramas/${id}`, data),
  del: (id: number) => api.del(`/dramas/${id}`),
}

export const episodeAPI = {
  get: (id: number) => api.get(`/episodes/${id}`),
  create: (data: any) => api.post('/episodes', data),
  update: (id: number, data: any) => api.put(`/episodes/${id}`, data),
  del: (id: number) => api.del(`/episodes/${id}`),
  characters: (id: number) => api.get(`/episodes/${id}/characters`),
  scenes: (id: number) => api.get(`/episodes/${id}/scenes`),
  props: (id: number) => api.get(`/episodes/${id}/props`),
  storyboards: (id: number) => api.get(`/episodes/${id}/storyboards`),
  pipelineStatus: (id: number) => api.get(`/episodes/${id}/pipeline-status`),
  extract: (id: number, target: string, model?: string, configId?: number) => api.post(`/episodes/${id}/extract`, { target, model: model || undefined, config_id: configId || undefined }),
  // 重试失败的资产提取：将失败原因作为反馈传给 Agent 优化重新提取
  retryExtract: (id: number, target: string, model?: string, configId?: number) => api.post(`/episodes/${id}/retry-extraction`, { target, model: model || undefined, config_id: configId || undefined }),
  extractStatus: (id: number) => api.get(`/episodes/${id}/extract-status`),
  generateVideoPrompts: (id: number, model?: string, configId?: number, storyboardIds?: number[]) => api.post(`/episodes/${id}/generate-video-prompts`, { model: model || undefined, config_id: configId || undefined, storyboard_ids: storyboardIds?.length ? storyboardIds : undefined }),
  // 重试失败的提示词分镜：将失败原因作为反馈传给 Agent 优化重新生成
  retryVideoPrompts: (id: number, model?: string, configId?: number, storyboardIds?: number[]) => api.post(`/episodes/${id}/retry-video-prompts`, { model: model || undefined, config_id: configId || undefined, storyboard_ids: storyboardIds?.length ? storyboardIds : undefined }),
  videoPromptsStatus: (id: number) => api.get(`/episodes/${id}/video-prompts-status`),
}

export const storyboardAPI = {
  create: (data: any) => api.post('/storyboards', data),
  update: (id: number, data: any) => api.put(`/storyboards/${id}`, data),
  del: (id: number) => api.del(`/storyboards/${id}`),
  // 异步分镜拆分：立即返回，后台执行，刷新页面不中断；配合 splitStatus 轮询进度
  split: (episodeId: number, dramaId: number, message: string, model?: string, configId?: number) => api.post<{ started?: boolean; already_running?: boolean }>('/agent/storyboard_breaker/run', { message, drama_id: dramaId, episode_id: episodeId, model: model || undefined, config_id: configId || undefined }),
  splitStatus: (episodeId: number) => api.get<{ status: 'idle' | 'running' | 'done' | 'failed'; storyboard_count: number; error?: string | null }>(`/agent/storyboard_breaker/status?episode_id=${episodeId}`),
  // 重试失败的拆分：将失败原因作为反馈传给 Agent 优化重新拆分
  retry: (episodeId: number, dramaId: number, message: string, model?: string, configId?: number) => api.post<{ started?: boolean; already_running?: boolean }>('/agent/storyboard_breaker/retry', { message, drama_id: dramaId, episode_id: episodeId, model: model || undefined, config_id: configId || undefined }),
}

// 异步剧本改写：立即返回，后台执行，刷新页面不中断；配合 status 轮询进度，retry 注入失败原因
export const rewriterAPI = {
  run: (episodeId: number, dramaId: number, message?: string, model?: string, configId?: number) => api.post<{ started?: boolean; already_running?: boolean }>('/agent/script_rewriter/run', { message: message || undefined, drama_id: dramaId, episode_id: episodeId, model: model || undefined, config_id: configId || undefined }),
  status: (episodeId: number) => api.get<{ status: 'idle' | 'running' | 'done' | 'failed'; error?: string | null }>(`/agent/script_rewriter/status?episode_id=${episodeId}`),
  retry: (episodeId: number, dramaId: number, message?: string, model?: string, configId?: number) => api.post<{ started?: boolean; already_running?: boolean }>('/agent/script_rewriter/retry', { message: message || undefined, drama_id: dramaId, episode_id: episodeId, model: model || undefined, config_id: configId || undefined }),
}

// 单集耗时明细与总耗时
export const timingAPI = {
  episode: (episodeId: number) => api.get<{ episode_id: number; stages: any[]; total_duration_ms: number | null; sum_stage_duration_ms: number | null }>(`/episodes/${episodeId}/timings`),
}
