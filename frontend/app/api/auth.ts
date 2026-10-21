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

// 成本 / 用户侧开关 / 配额 / 账号自助 API（经门面 ~/composables/useApi 汇总导出）
import { api } from './core'

// AI 成本：当前用户聚合 + 明细（管理员全量在 adminAPI.costs）
export const costAPI = {
  my: (params?: { drama_id?: number; episode_id?: number; limit?: number }) => {
    const query = new URLSearchParams()
    if (params?.drama_id) query.set('drama_id', String(params.drama_id))
    if (params?.episode_id) query.set('episode_id', String(params.episode_id))
    if (params?.limit) query.set('limit', String(params.limit))
    return api.get(`/costs/my${query.size ? `?${query.toString()}` : ''}`)
  },
}

// 模型调用总开关（用户侧）：关闭后后端拒绝一切新发起的 AI 调用，在途任务不受影响
export const aiCallAPI = {
  get: () => api.get<{ enabled: boolean; user_id: number }>('/auth/ai-call'),
  set: (enabled: boolean) => api.put<{ enabled: boolean }>('/auth/ai-call', { enabled }),
}

// 用户级模型价：从平台基准价导入 / 自定义改价，计价优先于平台刊例价
export const userModelPriceAPI = {
  list: (params?: { keyword?: string; billing_type?: string }) => {
    const query = new URLSearchParams()
    if (params?.keyword) query.set('keyword', params.keyword)
    if (params?.billing_type) query.set('billing_type', params.billing_type)
    return api.get(`/model-prices${query.size ? `?${query.toString()}` : ''}`)
  },
  catalog: (params?: { keyword?: string; billing_type?: string; page?: number; page_size?: number }) => {
    const query = new URLSearchParams()
    for (const k of ['keyword', 'billing_type', 'page', 'page_size'] as const) {
      if (params?.[k] !== undefined && params?.[k] !== '') query.set(k, String(params[k]))
    }
    return api.get(`/model-prices/catalog${query.size ? `?${query.toString()}` : ''}`)
  },
  import: (items: { provider?: string; model: string }[]) => api.post('/model-prices/import', { items }),
  create: (d: any) => api.post('/model-prices', d),
  update: (id: number, d: any) => api.put(`/model-prices/${id}`, d),
  remove: (id: number) => api.del(`/model-prices/${id}`),
}

/** 看门狗类型：retry = 失败任务自动重提，asset = 缺图资产自动补生成 */
export type WatchdogKind = 'retry' | 'asset'

// 后台看门狗用户侧授权（默认均不启动）：写接口返回两个开关的最新状态，便于一次性校准
export const watchdogAPI = {
  get: () => api.get<{ retry: boolean; asset: boolean }>('/auth/watchdogs'),
  set: (kind: WatchdogKind, enabled: boolean) =>
    api.put<{ retry: boolean; asset: boolean }>('/auth/watchdogs', { kind, enabled }),
}

// 当前用户存储配额状态（超额时用户侧展示告警）
export const quotaAPI = {
  status: () => api.get<{ used_bytes: number; quota_bytes: number; default_quota_bytes: number; custom_quota: boolean; exceeded: boolean; percent: number }>('/auth/storage-quota'),
}

// 账号自助操作：修改本人密码（后端校验原密码，改后当前登录态仍有效）
export const accountAPI = {
  changePassword: (d: { oldPassword: string; newPassword: string; confirmPassword: string }) =>
    api.post<{ changed: boolean }>('/auth/change-password', d),
}
