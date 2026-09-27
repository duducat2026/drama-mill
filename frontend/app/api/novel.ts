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

// 小说上传 / 自动分集 / 拆分模版 API（经门面 ~/composables/useApi 汇总导出）
import { api, BASE, authHeaders, cachedList, invalidateListCache } from './core'

// 小说上传与自动分集
export const novelAPI = {
  upload: (file: File, dramaId?: number | null, title?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    if (dramaId) fd.append('drama_id', String(dramaId))
    if (title) fd.append('title', title)
    return fetch(`${BASE}/novels/upload`, { method: 'POST', body: fd, headers: authHeaders() }).then(async (resp) => {
      const json = await resp.json()
      if (!resp.ok || (json.code && json.code >= 400)) throw new Error(json.message || `${resp.status}`)
      return json.data ?? json
    })
  },
  // 带 dramaId 返回数组；不带则文档库分页列表 { items, pagination }
  list: (params?: { drama_id?: number; keyword?: string; page?: number; page_size?: number }) => {
    const query = new URLSearchParams()
    if (params?.drama_id) query.set('drama_id', String(params.drama_id))
    if (params?.keyword) query.set('keyword', params.keyword)
    if (params?.page) query.set('page', String(params.page))
    if (params?.page_size) query.set('page_size', String(params.page_size))
    return api.get<any>(`/novels${query.size ? `?${query.toString()}` : ''}`)
  },
  content: (id: number) => api.get<{ id: number; title: string; content: string; char_count: number }>(`/novels/${id}/content`),
  update: (id: number, d: { title?: string; content?: string }) => api.put(`/novels/${id}`, d),
  del: (id: number) => api.del(`/novels/${id}`),
  batchDelete: (ids: number[]) => api.post<{ deleted: number }>('/novels/batch-delete', { ids }),
  // 批量选中小说创建项目并自动生产（已建项目的小说复用）；mode='split_only' 两步走：先拆分停下待确认再生产
  createProjects: (d: { novel_ids: number[]; style?: string; aspect_ratio?: string; target_chars?: number; split_template_id?: number; auto_start?: boolean; mode?: 'full' | 'split_only' }) => api.post('/novels/create-projects', d),
  // 小说生成的项目列表（含集数）
  dramas: (id: number) => api.get<any[]>(`/novels/${id}/dramas`),
  split: (id: number, targetChars?: number, templateId?: number) => api.post<{ status: string; started?: boolean; already_running?: boolean }>(`/novels/${id}/split`, { target_chars: targetChars || undefined, template_id: templateId || undefined }),
  splitStatus: (id: number) => api.get<{ status: string; progress?: string; error?: string; created_episodes: any[]; split_info: any }>(`/novels/${id}/split-status`),
  // 文档拆分：按提示词模版或手动参数把大文档拆成多个独立小说入库
  preSplit: (id: number, d: { paragraphs_per_novel?: number; target_novels?: number; title_prefix?: string; delete_source?: boolean; split_template_id?: number; split_mode?: 'chars' | 'paragraphs'; target_chars?: number }) => api.post<{ source_novel_id: number; source_deleted: boolean; source_paragraph_count: number; source_chapter_count: number; split_mode: string; split_template_id: number | null; created: { id: number; title: string; char_count: number; paragraph_count: number; chapter_count: number }[] }>(`/novels/${id}/pre-split`, d),
}

// 小说拆分提示词模版（系统内置 + 个人私有）
export const novelSplitTemplateAPI = {
  list: (all = false) => cachedList<any>(`novel-split-templates:${all}`, () => api.get(`/novel-split-templates${all ? '?all=1' : ''}`)),
  create: (d: any) => api.post('/novel-split-templates', d).then(r => { invalidateListCache('novel-split-templates:'); return r }),
  update: (id: number, d: any) => api.put(`/novel-split-templates/${id}`, d).then(r => { invalidateListCache('novel-split-templates:'); return r }),
  del: (id: number) => api.del(`/novel-split-templates/${id}`).then(r => { invalidateListCache('novel-split-templates:'); return r }),
}
