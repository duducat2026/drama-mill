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

// 统一生成任务（图片/视频）API（经门面 ~/composables/useApi 汇总导出）
import { api } from './core'

export const taskAPI = {
  generate: (d: any) => api.post('/tasks', d),
  get: (id: number) => api.get(`/tasks/${id}`),
  /** 失败原因诊断：上游状态码/错误码/请求 ID + 结论与修复建议 + 原始返回（密钥仅掩码） */
  failureDetail: (id: number) => api.get<any>(`/tasks/${id}/failure-detail`),
  del: (id: number) => api.del(`/tasks/${id}`),
  // 重试失败任务：重置为 processing 后重新入队执行
  retry: (id: number) => api.post(`/tasks/${id}/retry`, {}),
  // 并发队列状态：{ running, queued, max }
  queue: () => api.get<{ running: number; queued: number; max: number }>('/tasks/queue'),
  // 云端排队状态：云端总量 + 仅比对本人在途任务（不返回配置与云端陌生任务明细）
  cloudQueue: (params?: { model?: string }) => {
    const query = new URLSearchParams()
    if (params?.model) query.set('model', params.model)
    return api.get<any>(`/tasks/cloud-queue${query.size ? `?${query.toString()}` : ''}`)
  },
  // 任务列表：WHERE 下推 + 分页，返回 { items, pagination }；status 支持逗号分隔多值（如 pending,processing）
  list: (params?: { type?: 'image' | 'video'; drama_id?: number; storyboard_id?: number; status?: string; page?: number; page_size?: number }) => {
    const query = new URLSearchParams()
    if (params?.type) query.set('type', params.type)
    if (params?.drama_id) query.set('drama_id', String(params.drama_id))
    if (params?.storyboard_id) query.set('storyboard_id', String(params.storyboard_id))
    if (params?.status) query.set('status', params.status)
    if (params?.page) query.set('page', String(params.page))
    if (params?.page_size) query.set('page_size', String(params.page_size))
    return api.get<{ items: any[]; pagination: { page: number; page_size: number; total: number; total_pages: number } }>(`/tasks${query.size ? `?${query.toString()}` : ''}`)
  },
  // 按集聚合生成任务（sys_task + video_merges），sys_task 分页返回 { tasks, merges, pagination }
  listByEpisode: (episodeId: number, params?: { page?: number; page_size?: number }) => {
    const query = new URLSearchParams()
    if (params?.page) query.set('page', String(params.page))
    if (params?.page_size) query.set('page_size', String(params.page_size))
    return api.get<{ tasks: any[]; merges: any[]; pagination?: { page: number; page_size: number; total: number; total_pages: number } }>(`/episodes/${episodeId}/generation-tasks${query.size ? `?${query.toString()}` : ''}`)
  },
}
