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
  <div class="page novels-page">
    <div class="novels-inner">
    <div class="page-head">
      <div class="head-left">
        <h1 class="page-title">文档库</h1>
        <p class="page-sub">文档入库管理 · 批量创建项目自动生产</p>
      </div>
      <div class="head-actions">
        <button class="btn" @click="navigateTo('/novel-templates')">拆分模版</button>
        <button class="btn" @click="navigateTo('/')">返回首页</button>
        <button class="btn" @click="showBatchPanel = true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
          批量生产面板
        </button>
        <button class="btn btn-primary" @click="pickImportFiles">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          导入文档
        </button>
        <input ref="importInputEl" type="file" accept=".txt,.md,.docx" multiple hidden @change="onImportFiles" />
      </div>
    </div>

    <div class="toolbar">
        <label class="search-box">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input v-model.trim="keyword" class="input" placeholder="搜索文档名称" />
        </label>
        <span class="total-badge">{{ pagination.total }} 部文档</span>
        <div class="toolbar-right">
          <span v-if="selected.size" class="selected-info">已选 {{ selected.size }} 部</span>
          <button class="btn btn-sm" :disabled="!selected.size" @click="showBatchDelete = true">批量删除</button>
          <button class="btn btn-sm btn-primary" :disabled="!selected.size" @click="openCreateProjects">创建项目并生产</button>
        </div>
      </div>

      <div class="card list-card">
        <div v-if="loadingNovels" class="list-loading">加载中…</div>
        <template v-else-if="novels.length">
          <div class="list-row list-head">
            <label class="check-cell">
              <input type="checkbox" :checked="allSelected" @change="toggleAll" />
            </label>
            <span class="cell-title">文档名称</span>
            <span class="cell-num">字数</span>
            <span class="cell-num">章节</span>
            <span class="cell-status">拆分状态</span>
            <span class="cell-drama">所属项目</span>
            <span class="cell-time">导入时间</span>
            <span class="cell-actions">操作</span>
          </div>
          <div v-for="n in novels" :key="n.id" class="list-row" :class="{ selected: selected.has(n.id) }">
            <label class="check-cell">
              <input type="checkbox" :checked="selected.has(n.id)" @change="toggleOne(n.id)" />
            </label>
            <span class="cell-title truncate" :title="n.file_name">{{ n.title }}</span>
            <span class="cell-num">{{ (n.char_count || 0).toLocaleString() }}</span>
            <span class="cell-num">{{ n.chapter_count || 0 }}</span>
            <span class="cell-status"><span class="tag" :class="splitTagClass(n)">{{ splitLabel(n) }}</span></span>
            <span class="cell-drama truncate">
              <a v-if="n.drama_id && n.drama_title" class="drama-link" @click.prevent="navigateTo(`/drama/${n.drama_id}`)">{{ n.drama_title }}</a>
              <span v-else class="text-3">未创建</span>
            </span>
            <span class="cell-time">{{ fmtDate(n.created_at) }}</span>
            <span class="cell-actions">
              <button class="btn btn-sm btn-ghost" @click="openPreview(n)">预览</button>
              <button class="btn btn-sm btn-ghost" @click="openEdit(n)">编辑</button>
              <button v-if="!n.drama_id" class="btn btn-sm btn-ghost" @click="openPreSplit(n)">拆分</button>
              <button class="btn btn-sm btn-ghost" @click="openDramas(n)">项目</button>
              <button class="btn btn-sm btn-ghost is-danger" @click="novelToDelete = n">删除</button>
            </span>
          </div>
        </template>
        <div v-else class="empty-block">
          <p class="empty-title">{{ keyword ? '没有匹配的文档' : '文档库为空' }}</p>
          <p v-if="!keyword" class="empty-desc">导入文档后可在线管理、选择拆分模版创建项目</p>
        </div>
      </div>

      <div class="list-pager">
        <div class="pager-left">
          <div class="pager-size">
            <BaseSelect v-model="pageSize" :options="PAGE_SIZE_OPTIONS" :searchable="false" @update:model-value="changePageSize" />
            <span class="pager-size-suffix">条/页</span>
          </div>
          <span class="pager-info">共 <b>{{ pagination.total }}</b> 部</span>
        </div>
        <div v-if="pagination.total_pages > 1" class="pager-right">
          <button class="btn btn-sm pager-btn" :disabled="page <= 1" @click="gotoPage(page - 1)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <div class="pager-pages">
            <template v-for="(p, i) in pageList" :key="i">
              <span v-if="p === '...'" class="pager-ellipsis">…</span>
              <button v-else class="pager-page" :class="{ active: p === page }" @click="gotoPage(p)">{{ p }}</button>
            </template>
          </div>
          <button class="btn btn-sm pager-btn" :disabled="page >= pagination.total_pages" @click="gotoPage(page + 1)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>
      </div>

    <!-- 预览正文 -->
    <div v-if="preview" class="overlay" @click.self="preview = null">
      <div class="dialog preview-dialog">
        <div class="dialog-head">
          <h2 class="dialog-title truncate">{{ preview.title }}</h2>
          <span class="tag">{{ (preview.char_count || 0).toLocaleString() }} 字</span>
        </div>
        <div class="dialog-body preview-body">{{ preview.content }}</div>
        <div class="dialog-foot">
          <button class="btn" @click="preview = null">关闭</button>
        </div>
      </div>
    </div>

    <!-- 编辑小说 -->
    <div v-if="editing" class="overlay" @click.self="editing = null">
      <form class="dialog edit-dialog" @submit.prevent="saveEdit">
        <div class="dialog-head">
          <h2 class="dialog-title">编辑小说</h2>
        </div>
        <div class="dialog-body dialog-form-col">
          <label class="field">
            <span class="field-label">小说名称 <span class="required">*</span></span>
            <input v-model="editing.title" class="input" required />
          </label>
          <label class="field">
            <span class="field-label">正文 <span class="required">*</span></span>
            <textarea v-model="editing.content" class="textarea content-textarea" required></textarea>
            <span class="field-hint">修改正文后字数与章节数将重算，拆分状态重置为待拆分</span>
          </label>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="editing = null">取消</button>
          <button type="submit" class="btn btn-primary" :disabled="savingEdit">
            <Loader2 v-if="savingEdit" :size="13" class="animate-spin" />
            保存
          </button>
        </div>
      </form>
    </div>

    <!-- 小说生成的项目 -->
    <div v-if="dramasModal" class="overlay" @click.self="dramasModal = null">
      <div class="dialog dramas-dialog">
        <div class="dialog-head">
          <h2 class="dialog-title truncate">「{{ dramasModal.title }}」生成的项目</h2>
        </div>
        <div class="dialog-body">
          <div v-if="dramasModal.list.length" class="drama-list">
            <div v-for="d in dramasModal.list" :key="d.id" class="drama-row">
              <span class="drama-name truncate">{{ d.title }}</span>
              <span class="tag">{{ d.episode_count || 0 }} 集</span>
              <span class="tag tag-accent">{{ d.style }}</span>
              <button class="btn btn-sm btn-primary" @click="navigateTo(`/drama/${d.id}`)">打开项目</button>
            </div>
          </div>
          <p v-else class="empty-desc">该小说尚未生成项目，可在列表选中后点击「创建项目并生产」</p>
        </div>
        <div class="dialog-foot">
          <button class="btn" @click="dramasModal = null">关闭</button>
        </div>
      </div>
    </div>

    <!-- 批量创建项目 -->
    <NovelsCreateProjectsDialog
      :open="showCreateProjects"
      :novel-ids="[...selected]"
      :selected-count="selected.size"
      :templates="templates"
      :style-presets="stylePresets"
      @close="showCreateProjects = false"
      @submitted="onProjectsSubmitted"
    />

    <!-- 文档拆分 -->
    <NovelsPreSplitDialog
      :novel="preSplitNovel"
      :templates="templates"
      @close="preSplitNovel = null"
      @success="onPreSplitDone"
    />

    <ConfirmDialog
      :open="!!novelToDelete"
      title="删除文档"
      :message="`确定删除「${novelToDelete?.title}」？已生成的项目不受影响，文档本体将移入回收（不可在列表恢复）。`"
      :loading="deleting"
      @confirm="confirmDelete"
      @cancel="novelToDelete = null"
    />
    <ConfirmDialog
      :open="showBatchDelete"
      title="批量删除文档"
      :message="`确定删除选中的 ${selected.size} 部文档？已生成的项目不受影响。`"
      :loading="deleting"
      @confirm="confirmBatchDelete"
      @cancel="showBatchDelete = false"
    />

    <BatchProductionPanel v-if="showBatchPanel" @close="showBatchPanel = false" />
    </div>
  </div>
</template>

<script setup>
import { Loader2 } from 'lucide-vue-next'
import BaseSelect from '~/components/BaseSelect.vue'
import ConfirmDialog from '~/components/ConfirmDialog.vue'
import BatchProductionPanel from '~/components/BatchProductionPanel.vue'
import NovelsCreateProjectsDialog from '~/components/NovelsCreateProjectsDialog.vue'
import NovelsPreSplitDialog from '~/components/NovelsPreSplitDialog.vue'
import { useNovelsLibrary } from '~/composables/useNovelsLibrary'

const {
  keyword, novels, loadingNovels, selected, templates, stylePresets,
  PAGE_SIZE_OPTIONS, pageSize, page, pagination, pageList,
  gotoPage, changePageSize, allSelected, toggleAll, toggleOne,
  splitLabel, splitTagClass, fmtDate,
  importInputEl, pickImportFiles, onImportFiles,
  preview, openPreview,
  editing, savingEdit, openEdit, saveEdit,
  novelToDelete, showBatchDelete, deleting, confirmDelete, confirmBatchDelete,
  dramasModal, openDramas,
  showBatchPanel, showCreateProjects, preSplitNovel,
  openCreateProjects, onProjectsSubmitted, openPreSplit, onPreSplitDone,
} = useNovelsLibrary()
</script>

<style scoped src="~/assets/styles/novels.css"></style>
