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

// AI 配置 / 提示词 / 技能 / 视觉风格预设 API（经门面 ~/composables/useApi 汇总导出）
import { api, cachedList, invalidateListCache } from './core'

export const aiConfigAPI = {
  list: (t?: string) => api.get(`/ai-configs${t ? `?service_type=${t}` : ''}`),
  create: (d: any) => api.post('/ai-configs', d),
  update: (id: number, d: any) => api.put(`/ai-configs/${id}`, d),
  del: (id: number) => api.del(`/ai-configs/${id}`),
  test: (d: any) => api.post('/ai-configs/test', d),
  // 极简生成测试：文本同步回传结果；图片/视频返回 { task_id } 供轮询 /tasks/:id
  generateTest: (id: number) => api.post<{ service_type: string; model: string; text?: string; elapsed_ms?: number; task_id?: number }>(`/ai-configs/${id}/generate-test`),
}

export const promptAPI = {
  list: () => api.get('/prompts'),
  get: (type: string) => api.get(`/prompts/${type}`),
  update: (type: string, d: any) => api.put(`/prompts/${type}`, d),
  reset: (type: string) => api.post(`/prompts/${type}/reset`),
}

export const skillsAPI = {
  list: () => api.get('/skills'),
  get: (id: string) => api.get(`/skills/${id}`),
  create: (data: { id: string; name: string; description?: string }) => api.post('/skills', data),
  update: (id: string, content: string) => api.put(`/skills/${id}`, { content }),
  del: (id: string) => api.del(`/skills/${id}`),
}

export const stylePresetAPI = {
  list: (all = false) => cachedList<any>(`style-presets:${all}`, () => api.get(`/style-presets${all ? '?all=1' : ''}`)),
  create: (d: any) => api.post('/style-presets', d).then(r => { invalidateListCache('style-presets:'); return r }),
  update: (id: number, d: any) => api.put(`/style-presets/${id}`, d).then(r => { invalidateListCache('style-presets:'); return r }),
  del: (id: number) => api.del(`/style-presets/${id}`).then(r => { invalidateListCache('style-presets:'); return r }),
}
