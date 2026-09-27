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

import { toast } from 'vue-sonner'
import { api } from './useApi'

// Agent 聊天状态追踪 + 单次调用封装
// 并发安全：同一时刻仅允许一个 Agent 任务进行中
export function useAgent() {
  const running = ref(false)
  const runningType = ref<string | null>(null)

  async function run(
    agentKind: string,
    prompt: string,
    projectId: number,
    episodeNo: number,
    onFinish?: () => void,
    model?: string,
    configId?: number,
  ) {
    if (running.value) { toast.warning('操作执行中'); return }
    running.value = true
    runningType.value = agentKind
    try {
      await api.post<any>(`/agent/${agentKind}/chat`, {
        message: prompt,
        drama_id: projectId,
        episode_id: episodeNo,
        model: model || undefined,
        config_id: configId || undefined,
      })
      toast.success('完成')
      onFinish?.()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      running.value = false
      runningType.value = null
    }
  }

  return { running, runningType, run }
}
