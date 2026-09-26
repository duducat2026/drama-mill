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

// 顺序自动化生产 / 批量生产 / 视频合并 API（经门面 ~/composables/useApi 汇总导出）
import { api, BASE, authHeaders, redirectToLogin } from './core'

// 顺序自动化生产编排（启动/暂停/继续/状态）
export const productionAPI = {
  start: (dramaId: number, fromEpisodeNumber?: number) => api.post(`/production/dramas/${dramaId}/start`, { from_episode_number: fromEpisodeNumber || undefined }),
  pause: (dramaId: number) => api.post(`/production/dramas/${dramaId}/pause`),
  resume: (dramaId: number) => api.post(`/production/dramas/${dramaId}/resume`),
  status: (dramaId: number) => api.get<any>(`/production/dramas/${dramaId}/status`),
}

// 批量生产编排：一次上传多部小说，按顺序逐部完成分集与视频生产
export const productionBatchAPI = {
  // 多文件上传：每个文件自动建剧 + 入小说组成批次；auto_start=true 上传后立即启动；
  // mode='split_only' 两步走：先拆分入库停下，确认拆分结果后再调 produce 启动生产
  upload: (files: File[], opts: { style?: string; aspect_ratio?: string; target_chars?: number; split_template_id?: number; auto_start?: boolean; mode?: 'full' | 'split_only' } = {}) => {
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    if (opts.style) fd.append('style', opts.style)
    if (opts.aspect_ratio) fd.append('aspect_ratio', opts.aspect_ratio)
    if (opts.target_chars) fd.append('target_chars', String(opts.target_chars))
    if (opts.split_template_id) fd.append('split_template_id', String(opts.split_template_id))
    if (opts.mode) fd.append('mode', opts.mode)
    if (opts.auto_start) fd.append('auto_start', '1')
    return fetch(`${BASE}/production-batch/upload`, { method: 'POST', body: fd, headers: authHeaders() }).then(async (resp) => {
      const json = await resp.json()
      if (!resp.ok || (json.code && json.code >= 400)) {
        if (resp.status === 401) redirectToLogin('/production-batch/upload')
        throw new Error(json.message || `${resp.status}`)
      }
      return json.data ?? json
    })
  },
  list: () => api.get<any[]>('/production-batch'),
  get: (id: number) => api.get<any>(`/production-batch/${id}`),
  start: (id: number) => api.post(`/production-batch/${id}/start`, {}),
  // 两步走第二步：拆分结果确认后启动创作生产（将 split_only 批次改回 full 并启动）
  produce: (id: number) => api.post(`/production-batch/${id}/produce`, {}),
  pause: (id: number) => api.post(`/production-batch/${id}/pause`, {}),
  cancel: (id: number) => api.post(`/production-batch/${id}/cancel`, {}),
  rateConfig: () => api.get<any>('/production-batch/rate-config'),
}
export const mergeAPI = {
  merge: (epId: number, storyboardIds?: number[]) => api.post(`/merge/episodes/${epId}/merge`, storyboardIds?.length ? { storyboard_ids: storyboardIds } : {}),
  status: (epId: number) => api.get(`/merge/episodes/${epId}/merge`),
  list: (epId: number) => api.get<any[]>(`/merge/episodes/${epId}/merges`),
  remove: (epId: number, mergeId: number) => api.del(`/merge/episodes/${epId}/merges/${mergeId}`),
}
