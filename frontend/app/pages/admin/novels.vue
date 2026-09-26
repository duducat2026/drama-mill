<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/your-org/drama-mill)
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
    <h1 class="admin-page-title">小说管理</h1>
    <p class="admin-page-desc">全平台小说检索、预览与删除；管理拆分提示词模版（系统内置模版对所有用户生效）。</p>

    <div class="admin-toolbar">
      <button :class="['admin-tab', { active: tab === 'novels' }]" @click="tab = 'novels'">
        <BookOpen :size="14" /> 小说列表
      </button>
      <button :class="['admin-tab', { active: tab === 'templates' }]" @click="tab = 'templates'">
        <FileText :size="14" /> 拆分提示词模版
      </button>
    </div>

    <!-- ===== 标签一：小说列表检索 ===== -->
    <div v-if="tab === 'novels'">
      <div class="admin-toolbar">
        <input v-model.trim="filters.username" class="input" placeholder="用户名" style="width:130px" @keyup.enter="searchNovels" />
        <input v-model.trim="filters.keyword" class="input" placeholder="小说名称" style="width:160px" @keyup.enter="searchNovels" />
        <input v-model="filters.from" class="input" type="date" style="width:150px" />
        <span class="dim" style="font-size:12px">至</span>
        <input v-model="filters.to" class="input" type="date" style="width:150px" />
        <button class="btn btn-primary btn-sm" @click="searchNovels">
          <Search :size="12" /> 检索
        </button>
        <button class="btn btn-sm" @click="resetFilters">重置</button>
      </div>

      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>小说名称</th>
              <th>所属用户</th>
              <th>字数 / 章节</th>
              <th>拆分状态</th>
              <th>所属项目</th>
              <th>创建时间</th>
              <th style="text-align:right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loadingNovels">
              <td colspan="8" class="admin-empty">加载中…</td>
            </tr>
            <tr v-else-if="!novels.length">
              <td colspan="8" class="admin-empty">没有匹配的小说</td>
            </tr>
            <tr v-for="n in novels" v-else :key="n.id">
              <td>{{ n.id }}</td>
              <td>
                <div class="admin-cell-text" style="font-weight:600">{{ n.title }}</div>
                <div class="admin-cells-sub">{{ n.file_name }}</div>
              </td>
              <td>{{ n.username || '—' }}</td>
              <td>{{ (n.char_count || 0).toLocaleString() }} / {{ n.chapter_count || 0 }}</td>
              <td><span class="admin-tag" :class="splitTagClass(n)">{{ splitLabel(n) }}</span></td>
              <td>
                <span v-if="n.drama_title" class="admin-cell-text">{{ n.drama_title }}</span>
                <span v-else class="dim">未创建</span>
              </td>
              <td class="dim">{{ fmtDateTime(n.created_at) }}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn-ghost btn-sm" @click="openPreview(n)">预览</button>
                <button class="btn btn-ghost btn-sm" @click="openDramas(n)">项目</button>
                <button class="btn btn-danger btn-sm" @click="novelToDelete = n">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="totalPages > 1" class="admin-pager">
        <button class="btn btn-sm" :disabled="page <= 1" @click="gotoPage(page - 1)">上一页</button>
        <span>第 {{ page }} / {{ totalPages }} 页 · 共 {{ novelTotal }} 部</span>
        <button class="btn btn-sm" :disabled="page >= totalPages" @click="gotoPage(page + 1)">下一页</button>
      </div>
    </div>

    <!-- ===== 标签二：拆分提示词模版（外提为子组件） ===== -->
    <AdminNovelSplitTemplates v-else />

    <!-- 小说预览 -->
    <div v-if="preview" class="overlay" @click.self="preview = null">
      <div class="dialog novel-preview-dialog">
        <div class="dialog-head">
          <div>
            <h2 class="dialog-title">{{ preview.title }}</h2>
            <p class="dim" style="font-size:12px;margin:2px 0 0">
              {{ preview.username || '—' }} · {{ (preview.char_count || 0).toLocaleString() }} 字 · {{ preview.chapter_count || 0 }} 章
            </p>
          </div>
        </div>
        <div class="dialog-body novel-preview-body">{{ preview.content }}</div>
        <div class="dialog-foot">
          <button class="btn" @click="preview = null">关闭</button>
        </div>
      </div>
    </div>

    <!-- 小说生成的项目 -->
    <div v-if="dramasModal" class="overlay" @click.self="dramasModal = null">
      <div class="dialog novel-dramas-dialog">
        <div class="dialog-head">
          <h2 class="dialog-title">「{{ dramasModal.title }}」生成的项目</h2>
        </div>
        <div class="dialog-body">
          <div v-if="dramasModal.list.length" class="drama-list">
            <div v-for="d in dramasModal.list" :key="d.id" class="drama-row">
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:13px">{{ d.title }}</div>
                <div class="dim" style="font-size:11.5px;margin-top:2px">{{ d.username || '—' }} · {{ d.episode_count || 0 }} 集 · {{ d.aspect_ratio }}</div>
              </div>
              <span class="admin-tag">{{ d.status }}</span>
              <button class="btn btn-sm btn-primary" @click="navigateTo(`/drama/${d.id}`)">打开项目</button>
            </div>
          </div>
          <p v-else class="dim" style="font-size:12.5px;margin:0">该小说尚未生成项目</p>
        </div>
        <div class="dialog-foot">
          <button class="btn" @click="dramasModal = null">关闭</button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :open="!!novelToDelete"
      title="删除小说"
      :message="`确定删除「${novelToDelete?.title}」（${novelToDelete?.username || '未知用户'}）？已生成的项目不受影响。`"
      :loading="deleting"
      @confirm="confirmDeleteNovel"
      @cancel="novelToDelete = null"
    />
  </div>
</template>

<script setup>
definePageMeta({ layout: 'admin' })

import { toast } from 'vue-sonner'
import { BookOpen, FileText, Search } from 'lucide-vue-next'
import { adminAPI } from '~/composables/useApi'
import ConfirmDialog from '~/components/ConfirmDialog.vue'
import AdminNovelSplitTemplates from '~/components/AdminNovelSplitTemplates.vue'

const tab = ref('novels')

// ─── 小说列表检索 ──────────────────────────────────────

const PAGE_SIZE = 20
const filters = ref({ username: '', keyword: '', from: '', to: '' })
const page = ref(1)
const novelTotal = ref(0)
const totalPages = computed(() => Math.max(1, Math.ceil(novelTotal.value / PAGE_SIZE)))
const novels = ref([])
const loadingNovels = ref(false)

async function loadNovels() {
  loadingNovels.value = true
  try {
    const res = await adminAPI.novels({
      username: filters.value.username || undefined,
      keyword: filters.value.keyword || undefined,
      from: filters.value.from || undefined,
      to: filters.value.to || undefined,
      page: page.value,
      page_size: PAGE_SIZE,
    })
    novels.value = res.items || []
    novelTotal.value = res.total || 0
  } catch (e) {
    toast.error(e.message)
  } finally {
    loadingNovels.value = false
  }
}

function searchNovels() { page.value = 1; loadNovels() }
function resetFilters() {
  filters.value = { username: '', keyword: '', from: '', to: '' }
  page.value = 1
  loadNovels()
}
function gotoPage(p) {
  if (p < 1 || p > totalPages.value) return
  page.value = p
  loadNovels()
}

const SPLIT_LABELS = { uploaded: '待拆分', splitting: '拆分中', split: '已拆分', failed: '拆分失败' }
function splitLabel(n) { return SPLIT_LABELS[n.split_status] || n.split_status || '待拆分' }
function splitTagClass(n) {
  return n.split_status === 'split' ? 'admin-tag-green' : n.split_status === 'splitting' ? 'admin-tag-blue' : n.split_status === 'failed' ? 'admin-tag-red' : 'admin-tag-gray'
}
function fmtDateTime(s) {
  if (!s) return '—'
  const d = new Date(s)
  return `${d.toLocaleDateString('zh-CN')} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

const preview = ref(null)
async function openPreview(n) {
  try {
    preview.value = await adminAPI.novelContent(n.id)
  } catch (e) {
    toast.error(e.message)
  }
}

const dramasModal = ref(null)
async function openDramas(n) {
  try {
    const list = await adminAPI.novelDramas(n.id)
    dramasModal.value = { title: n.title, list: list || [] }
  } catch (e) {
    toast.error(e.message)
  }
}

const novelToDelete = ref(null)
const deleting = ref(false)
async function confirmDeleteNovel() {
  const n = novelToDelete.value
  if (!n) return
  deleting.value = true
  try {
    await adminAPI.deleteNovel(n.id)
    toast.success('已删除')
    novelToDelete.value = null
    loadNovels()
  } catch (e) {
    toast.error(e.message)
  } finally {
    deleting.value = false
  }
}

// ─── 拆分提示词模版 ────────────────────────────────────

// 模版面板（检索/新建/编辑/删除/预览）已外提为 AdminNovelSplitTemplates 子组件

onMounted(loadNovels)
</script>

<style scoped src="~/assets/styles/admin-novels.css"></style>
