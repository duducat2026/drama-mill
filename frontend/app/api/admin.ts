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

// 管理后台全量接口（后端已做 admin 角色守卫，经门面 ~/composables/useApi 汇总导出）
import { api, adminQuery } from './core'

export const adminAPI = {
  users: (params?: any) => api.get(`/admin/users${adminQuery(params)}`),
  createUser: (d: any) => api.post('/admin/users', d),
  updateUser: (id: number, d: any) => api.put(`/admin/users/${id}`, d),
  assets: (params?: any) => api.get(`/admin/assets${adminQuery(params)}`),
  aiConfigs: (params?: any) => api.get(`/admin/ai-configs${adminQuery(params)}`),
  audit: (params?: any) => api.get(`/admin/audit${adminQuery(params)}`),
  dramas: (params?: any) => api.get(`/admin/dramas${adminQuery(params)}`),
  dramaEpisodes: (id: number) => api.get(`/admin/dramas/${id}/episodes`),
  storyboards: (params?: any) => api.get(`/admin/storyboards${adminQuery(params)}`),
  videos: (params?: any) => api.get(`/admin/videos${adminQuery(params)}`),
  // 重提单个失败视频任务（手动重试重置重试计数）
  retryVideo: (id: number) => api.post(`/admin/videos/${id}/retry`, {}),
  // 一键重提全部失败视频任务（最近优先，上限 100 条）
  retryFailedVideos: () => api.post<{ retried: number; skipped: number; total_failed: number }>('/admin/videos/retry-failed', {}),
  // 历史任务补跑：探测带上游 task_id 的失败任务，救回/恢复轮询不重新提交（不重复计费）
  rescueHistoricalVideos: () => api.post<{ probed: number; rescued: number; resumed: number; skipped: number; total_eligible: number }>('/admin/videos/rescue-historical', {}),
  // 失败任务自动重提上限（运行时可改 0~9，0 = 关闭自动恢复，无需重启即时生效）
  retryConfig: () => api.get<{ auto_retry_max: number; hard_max: number; env_default: number }>('/admin/task-retry-config'),
  updateRetryConfig: (v: number) => api.put<{ auto_retry_max: number }>('/admin/task-retry-config', { auto_retry_max: v }),
  // 放弃/复活失败任务：放弃后自动重提/手动重试/资产补跑全部停止（防无法处理的任务反复提交）
  abandonVideo: (id: number) => api.post(`/admin/videos/${id}/abandon`, {}),
  restoreVideo: (id: number) => api.post(`/admin/videos/${id}/restore`, {}),
  merges: (params?: any) => api.get(`/admin/merges${adminQuery(params)}`),
  panel: () => api.get('/admin/panel'),
  // 存储监控：磁盘空间 + 生成素材/视频大小（df/du 探测，可能稍慢）
  storageStats: () => api.get('/admin/storage-stats'),
  // 运行监控：任务趋势/状态分布/失败画像/网关健康（后端聚合，轻量）
  monitorStats: () => api.get('/admin/monitor-stats'),
  // 云端队列状态：DashScope 批量任务接口查询上游排队/在途，与本地 sys_task 比对；
  // user_id 指定时加载该用户的视频配置（模型 + API-KEY）查询
  cloudQueue: (params?: { model?: string; config_id?: number; user_id?: number }) => api.get(`/admin/cloud-queue${adminQuery(params)}`),
  costs: (params?: any) => api.get(`/admin/costs${adminQuery(params)}`),
  modelPrices: (params?: any) => api.get(`/admin/model-prices${adminQuery(params)}`),
  createModelPrice: (d: any) => api.post('/admin/model-prices', d),
  updateModelPrice: (id: number, d: any) => api.put(`/admin/model-prices/${id}`, d),
  // 模型目录价（平台侧：从独立 model_list 库只读提取模型清单与价格列表）
  modelCatalogStats: () => api.get('/admin/model-catalog/stats'),
  modelCatalogModels: (params?: any) => api.get(`/admin/model-catalog/models${adminQuery(params)}`),
  modelCatalogPrices: (params?: any) => api.get(`/admin/model-catalog/prices${adminQuery(params)}`),
  modelCatalogPricesOf: (modelId: string) => api.get(`/admin/model-catalog/prices-of?model_id=${encodeURIComponent(modelId)}`),
  // 将目录价导入平台刊例价：dry_run 预览，否则正式写入
  importModelCatalog: (d: { usd_rate?: number; dry_run?: boolean }) => api.post('/admin/model-catalog/import', d),
  // 平台小说管理：按用户名/小说名/创建日期范围检索
  novels: (params?: { username?: string; keyword?: string; from?: string; to?: string; page?: number; page_size?: number }) => api.get(`/admin/novels${adminQuery(params)}`),
  novelContent: (id: number) => api.get(`/admin/novels/${id}/content`),
  deleteNovel: (id: number) => api.del(`/admin/novels/${id}`),
  novelDramas: (id: number) => api.get(`/admin/novels/${id}/dramas`),
  // 平台拆分提示词模版管理（默认创建系统内置模版）
  novelSplitTemplates: (params?: { keyword?: string; system_only?: number }) => api.get(`/admin/novel-split-templates${adminQuery(params)}`),
  createNovelSplitTemplate: (d: any) => api.post('/admin/novel-split-templates', d),
  updateNovelSplitTemplate: (id: number, d: any) => api.put(`/admin/novel-split-templates/${id}`, d),
  deleteNovelSplitTemplate: (id: number) => api.del(`/admin/novel-split-templates/${id}`),
}
