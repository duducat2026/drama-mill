<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
  Copyright (C) 2026 Drama Mill <52859273@qq.com>

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU Affero General Public License for more details.

  You should have received a copy of the GNU Affero General Public License
  along with this program.  If not, see <https://www.gnu.org/licenses/>.
-->

<template>
  <div>
    <div class="admin-page-title">平台视频</div>
    <div class="admin-page-desc">全平台视频生成任务（sys_task）列表，按用户/项目名/状态检索</div>

    <div class="admin-toolbar">
      <select v-model="filters.user_id" class="input" @change="load(1)">
        <option value="">全部用户</option>
        <option v-for="u in userOptions" :key="u.id" :value="u.id">{{ u.username }}</option>
      </select>
      <select v-model="filters.status" class="input" @change="load(1)">
        <option value="">全部状态</option>
        <option value="processing">生成中</option>
        <option value="completed">已完成</option>
        <option value="failed">失败</option>
      </select>
      <input v-model="filters.keyword" class="input" placeholder="搜索提示词/模型/项目名" @keyup.enter="load(1)" />
      <button class="btn btn-sm" @click="load(1)">查询</button>
      <button class="btn btn-sm" :disabled="retryingAll" :title="'将全部失败的视频任务重新提交生成（最近优先，上限 100 条）'" @click="retryAllFailed">
        {{ retryingAll ? '重提中…' : '一键重提失败任务' }}
      </button>
      <button class="btn btn-sm" :disabled="rescuing" :title="'探测已提交过上游的失败任务：上游已生成完则直接救回，仍在生成则恢复轮询，不重新提交、不重复计费'" @click="rescueHistorical">
        {{ rescuing ? '探测中…' : '补跑历史任务' }}
      </button>
    </div>

    <!-- 失败任务自动重提上限（运行时配置，无需重启即时生效）：已抽离为 AdminRetryConfigBar 组件 -->
    <AdminRetryConfigBar />

    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr><th>ID</th><th>预览</th><th>项目</th><th>模型</th><th>提示词</th><th>状态</th><th>用户</th><th>创建时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in rows" :key="t.id">
            <td>{{ t.id }}</td>
            <td>
              <video v-if="t.status === 'completed' && t.local_path" class="admin-preview" :src="mediaUrl(t.local_path)" :poster="posterOf(mediaUrl(t.local_path))" muted preload="metadata" @click="preview = t" style="cursor:zoom-in" />
              <span v-else>-</span>
            </td>
            <td><div class="admin-cell-text">{{ t.drama_title || '-' }}</div></td>
            <td><div class="admin-cell-text">{{ t.provider }} / {{ t.model || '-' }}</div></td>
            <td><div class="admin-cell-text" :title="t.prompt">{{ t.prompt || '-' }}</div></td>
            <td>
              <span class="admin-tag" :class="statusClass(t.status)" :title="t.status === 'failed' ? (t.error_msg || '生成失败') : ''">{{ STATUS_LABEL[t.status] || t.status }}</span>
              <span v-if="isAbandoned(t)" class="admin-tag admin-tag-gray" title="已人工放弃：自动重提/手动重试/资产补跑均已停止">已放弃</span>
              <span v-else-if="t.status === 'failed' && t.retry_count > 0" class="admin-tag admin-tag-gray" :title="`已自动重提 ${t.retry_count} 次`">重试 {{ t.retry_count }}</span>
              <div v-if="t.status === 'failed' && t.error_msg" class="video-task-error" :title="t.error_msg">{{ t.error_msg }}</div>
            </td>
            <td>{{ t.username || '-' }}</td>
            <td>{{ fmt(t.created_at) }}</td>
            <td>
              <template v-if="t.status === 'failed' && !isAbandoned(t)">
                <button
                  class="btn btn-sm"
                  title="重新提交该任务（复用原参数与原配置）"
                  :disabled="retryingIds.includes(t.id)"
                  @click="retryOne(t)"
                >
                  {{ retryingIds.includes(t.id) ? '重提中…' : '重试' }}
                </button>
                <button
                  class="btn btn-sm"
                  title="放弃该任务：自动重提/手动重试/资产补跑全部停止，适用于内容永远过不了审等无法处理的任务"
                  @click="abandonOne(t)"
                >
                  放弃
                </button>
              </template>
              <button
                v-else-if="isAbandoned(t)"
                class="btn btn-sm"
                title="复活：清除放弃标记（重试计数归零），恢复可重试状态"
                @click="restoreOne(t)"
              >
                复活
              </button>
              <span v-else>-</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!rows.length" class="admin-empty">暂无视频任务</div>
    </div>

    <div class="admin-pager">
      <span>共 {{ total }} 条 · 第 {{ page }} 页</span>
      <button class="btn btn-sm" :disabled="page <= 1" @click="load(page - 1)">上一页</button>
      <button class="btn btn-sm" :disabled="rows.length < pageSize" @click="load(page + 1)">下一页</button>
    </div>

    <!-- 预览弹窗 -->
    <div v-if="preview" class="admin-modal-mask" @click.self="preview = null">
      <div class="video-preview-box">
        <video :src="mediaUrl(preview.local_path)" :poster="posterOf(mediaUrl(preview.local_path))" controls autoplay />
        <div class="video-preview-name">任务 #{{ preview.id }} · {{ preview.model || '' }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { adminAPI } from '~/composables/useApi'
import { posterOf } from '~/composables/useMedia'
import { toast } from 'vue-sonner'
definePageMeta({ layout: 'admin' })

const STATUS_LABEL: Record<string, string> = { processing: '生成中', completed: '已完成', failed: '失败' }

const filters = reactive({ user_id: '', status: '', keyword: '' })
const rows = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const preview = ref<any>(null)
const userOptions = ref<any[]>([])
const retryingAll = ref(false)
const retryingIds = ref<number[]>([])
const rescuing = ref(false)

/** 放弃标记：后端以 retry_count=99 表示人工放弃 */
function isAbandoned(t: any) {
  return (t?.retry_count || 0) >= 99
}

function fmt(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '-'
}
function mediaUrl(p?: string | null) {
  if (!p) return ''
  return p.startsWith('/') || p.startsWith('http') ? p : `/${p}`
}
function statusClass(status: string) {
  if (status === 'completed') return 'admin-tag-green'
  if (status === 'failed') return 'admin-tag-red'
  return 'admin-tag-blue'
}

async function load(p = 1) {
  page.value = p
  const data = await adminAPI.videos({ user_id: filters.user_id, status: filters.status, keyword: filters.keyword, page: p, page_size: pageSize.value })
  rows.value = data.items
  total.value = data.total
}

// 一键重提：后端按最近失败优先批量重提（上限 100 条），手动重试会重置自动恢复计数
async function retryAllFailed() {
  retryingAll.value = true
  try {
    const res = await adminAPI.retryFailedVideos()
    if (res.retried) toast.success(`已重新提交 ${res.retried} 个失败任务${res.skipped ? `，${res.skipped} 个暂不可重提` : ''}`)
    else toast.warning('没有可重提的失败任务')
    await load(page.value)
  } catch (e: any) {
    toast.error(e.message || '重提失败')
  } finally {
    retryingAll.value = false
  }
}

// 历史任务补跑：探测带上游 task_id 的失败任务，救回不重新提交（探测需逐批查上游，耗时较长）
async function rescueHistorical() {
  rescuing.value = true
  toast.info('正在探测历史任务，可能需要几分钟…')
  try {
    const res = await adminAPI.rescueHistoricalVideos()
    if (res.rescued || res.resumed) toast.success(`已救回 ${res.rescued} 个，恢复轮询 ${res.resumed} 个（共探测 ${res.probed} 个）`)
    else toast.warning(`探测 ${res.probed} 个，无可救回的任务（上游均已失败或记录过期）`)
    await load(page.value)
  } catch (e: any) {
    toast.error(e.message || '补跑失败')
  } finally {
    rescuing.value = false
  }
}

async function retryOne(t: any) {
  retryingIds.value = [...retryingIds.value, t.id]
  try {
    await adminAPI.retryVideo(t.id)
    toast.success(`任务 #${t.id} 已重新提交生成`)
    await load(page.value)
  } catch (e: any) {
    toast.error(e.message || '重提失败')
  } finally {
    retryingIds.value = retryingIds.value.filter(id => id !== t.id)
  }
}

async function abandonOne(t: any) {
  try {
    await adminAPI.abandonVideo(t.id)
    toast.success(`任务 #${t.id} 已放弃：不再自动重提/补跑`)
    await load(page.value)
  } catch (e: any) {
    toast.error(e.message || '放弃失败')
  }
}

async function restoreOne(t: any) {
  try {
    await adminAPI.restoreVideo(t.id)
    toast.success(`任务 #${t.id} 已复活，可重新重试`)
    await load(page.value)
  } catch (e: any) {
    toast.error(e.message || '复活失败')
  }
}

onMounted(() => {
  // 用户下拉与列表并行：串行 await 会给首屏多挡一个往返
  adminAPI.users({ page: 1, page_size: 200 })
    .then(users => { userOptions.value = users.items })
    .catch(() => { /* 用户列表失败不阻断列表加载 */ })
  load(1)
})
</script>

<style scoped>
.admin-modal-mask {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
}
.video-preview-box { display: flex; flex-direction: column; align-items: center; gap: 10px; max-width: 80vw; max-height: 85vh; }
.video-preview-box video { max-width: 80vw; max-height: 78vh; border-radius: 10px; background: #000; }
.video-preview-name { color: #fff; font-size: 12.5px; opacity: 0.85; }
.video-task-error {
  max-width: 180px;
  margin-top: 3px;
  font-size: 11px;
  color: #e5484d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
