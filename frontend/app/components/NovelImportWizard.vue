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
  <div class="overlay" @click.self="close">
    <div class="dialog wizard-dialog">
      <div class="dialog-head">
        <div class="wizard-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
        </div>
        <div class="dialog-head-copy">
          <h2 class="dialog-title">导入文档 · 自动分集</h2>
          <p class="dialog-desc">第 {{ step }}/3 步 · {{ STEP_TITLES[step - 1] }}</p>
        </div>
        <div class="step-track" aria-hidden="true">
          <span v-for="i in 3" :key="i" class="step-dot" :class="{ on: i <= step }"></span>
        </div>
      </div>

      <!-- 第 1 步：选择文件 + 建剧（支持多选，多选时进入批量生产模式） -->
      <form v-if="step === 1" class="dialog-form" @submit.prevent="isBatch ? createBatch() : createAndUpload()">
        <div class="dialog-body">
          <label class="field">
            <span class="field-label">小说文件 <span class="required">*</span></span>
            <input class="input" type="file" accept=".txt,.md,.docx" multiple required @change="onPickFile" />
            <span class="field-hint">支持 .txt / .md / .docx（≤10MB），UTF-8 / GB18030 编码自动识别；可同时选择多部小说批量生产</span>
          </label>

          <!-- 批量模式：文件清单 -->
          <div v-if="isBatch" class="batch-file-list">
            <div v-for="(f, i) in files" :key="i" class="batch-file-row">
              <span class="batch-file-seq">{{ i + 1 }}</span>
              <span class="batch-file-name truncate">{{ f.name }}</span>
              <span class="batch-file-size">{{ (f.size / 1024).toFixed(0) }} KB</span>
            </div>
          </div>

          <label v-if="!isBatch" class="field">
            <span class="field-label">项目名称 <span class="required">*</span></span>
            <input v-model="form.title" class="input" placeholder="例如：盗情" required />
          </label>
          <label class="field">
            <span class="field-label">视觉风格</span>
            <BaseSelect v-model="form.style" :options="styleSelectOptions" placeholder="选择风格" searchable />
            <span v-if="selectedStyleDesc" class="field-hint">{{ selectedStyleDesc }}</span>
          </label>
          <label class="field">
            <span class="field-label">画面比例</span>
            <BaseSelect v-model="form.aspect_ratio" :options="aspectRatioOptions" placeholder="选择画面比例" />
            <span class="field-hint">创建后固定，视频生成将统一使用该比例</span>
          </label>

          <!-- 批量模式：拆分模版 + 分集参数 + 执行方式（两步走） -->
          <template v-if="isBatch">
            <label class="field">
              <span class="field-label">拆分提示词模版</span>
              <BaseSelect v-model="splitTemplateId" :options="splitTemplateOptions" placeholder="选择拆分模版" />
              <span v-if="batchTplIsParagraphs" class="field-hint">该模版按段落数量拆分（每集 {{ batchTplParagraphs }} 段，空行分隔的一段即一首/一则），下方字数不生效</span>
              <span v-else class="field-hint">基于模版提示词指导 AI 拆分，不选则用默认规则</span>
            </label>
            <label v-if="!batchTplIsParagraphs" class="field">
              <span class="field-label">每集目标字数</span>
              <input v-model.number="targetChars" class="input target-input" type="number" min="2000" step="1000" />
              <span class="field-hint">每部小说按章节边界归组到该字数附近，项目名取文件名</span>
            </label>
            <label class="field">
              <span class="field-label">执行方式</span>
              <div class="mode-picker">
                <label class="mode-option" :class="{ on: batchMode === 'split_only' }">
                  <input v-model="batchMode" type="radio" value="split_only" />
                  <span class="mode-copy">
                    <span class="mode-name">先拆分，确认后再生产 <span class="mode-rec">推荐</span></span>
                    <span class="mode-desc">上传后自动拆分成多份入库，拆分完成即停；确认分集结果后再启动创作生产</span>
                  </span>
                </label>
                <label class="mode-option" :class="{ on: batchMode === 'full' }">
                  <input v-model="batchMode" type="radio" value="full" />
                  <span class="mode-copy">
                    <span class="mode-name">拆分并直接生产</span>
                    <span class="mode-desc">拆分后自动续接图片/视频生产，可随时暂停</span>
                  </span>
                </label>
              </div>
            </label>
            <p class="batch-tip">将真实消耗文本/图片/视频生成额度；各环节并发受平台速率配置约束</p>
          </template>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="close">取消</button>
          <button type="submit" class="btn btn-primary" :disabled="busy">
            <Loader2 v-if="busy" :size="13" class="animate-spin" />
            {{ isBatch ? (batchMode === 'split_only' ? '建批并启动拆分' : '建批并启动生产') : '建剧并上传' }}
          </button>
        </div>
      </form>

      <!-- 第 2 步：拆分设置 + 预览 -->
      <div v-else-if="step === 2" class="dialog-form">
        <div class="dialog-body">
          <div class="novel-meta">
            <span class="tag tag-accent">{{ novel?.char_count?.toLocaleString() || 0 }} 字</span>
            <span class="tag">{{ novel?.chapter_count || 0 }} 章</span>
            <span v-if="existingEpisodes > 0" class="tag tag-warn">已有 {{ existingEpisodes }} 集，继续拆分将追加</span>
          </div>
          <label class="field">
            <span class="field-label">拆分提示词模版</span>
            <BaseSelect v-model="splitTemplateId" :options="splitTemplateOptions" placeholder="选择拆分模版" :disabled="splitting" />
            <span v-if="singleTplIsParagraphs" class="field-hint">该模版按段落数量拆分（每集 {{ singleTplParagraphs }} 段），下方字数不生效</span>
            <span v-else class="field-hint">基于模版提示词指导 AI 拆分，不选则用默认规则</span>
          </label>
          <label v-if="!singleTplIsParagraphs" class="field">
            <span class="field-label">每集目标字数</span>
            <input v-model.number="targetChars" class="input target-input" type="number" min="2000" step="1000" :disabled="splitting" />
            <span class="field-hint">按章节边界贪心归组到该字数附近，预计 {{ estimatedEpisodes }} 集</span>
          </label>

          <div v-if="splitting" class="split-progress">
            <Loader2 :size="18" class="animate-spin" />
            <span>{{ splitProgress || '拆分进行中…' }}</span>
          </div>
          <div v-else-if="splitError" class="split-error">{{ splitError }}</div>

          <div v-if="preview.length" class="preview-list">
            <div class="preview-head">分集预览（{{ preview.length }} 集）</div>
            <div v-for="ep in preview" :key="ep.episode_number" class="preview-row">
              <span class="preview-num">第 {{ ep.episode_number }} 集</span>
              <span class="preview-title truncate">{{ ep.title }}</span>
              <span class="preview-chars">{{ (ep.char_count || 0).toLocaleString() }} 字</span>
            </div>
          </div>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="goDetail">跳过，稍后处理</button>
          <button v-if="!preview.length" type="button" class="btn btn-primary" :disabled="splitting || !targetChars" @click="startSplit">
            <Loader2 v-if="splitting" :size="13" class="animate-spin" />
            {{ splitting ? '拆分中…' : '开始拆分' }}
          </button>
          <button v-else type="button" class="btn btn-primary" @click="step = 3">下一步</button>
        </div>
      </div>

      <!-- 第 3 步：启动自动生产 -->
      <div v-else class="dialog-form">
        <div class="dialog-body">
          <label class="check-row">
            <input v-model="autoStart" type="checkbox" />
            <span>自动开始视频生产（按集顺序执行完整流水线，可随时暂停）</span>
          </label>
          <label v-if="autoStart" class="field">
            <span class="field-label">起始集</span>
            <select v-model.number="fromEpisodeNumber" class="input">
              <option v-for="ep in preview" :key="ep.episode_number" :value="ep.episode_number">
                第 {{ ep.episode_number }} 集 · {{ ep.title }}
              </option>
            </select>
            <span class="field-hint">将真实消耗图片/视频生成额度；全部集费用较高，建议先跑 1 集验证效果</span>
          </label>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="goDetail">稍后手动</button>
          <button type="button" class="btn btn-primary" :disabled="busy" @click="finish">
            <Loader2 v-if="busy" :size="13" class="animate-spin" />
            {{ autoStart ? '启动自动生产' : '进入项目' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { Loader2 } from 'lucide-vue-next'
import BaseSelect from '~/components/BaseSelect.vue'
import { useNovelWizard, STEP_TITLES } from '~/composables/useNovelWizard'

const emit = defineEmits(['close', 'created', 'batch-created'])

// 向导全部步骤状态与逻辑外提至 useNovelWizard（拆分超限文件），组件仅保留模板
const {
  step, busy, files, isBatch, form, styleSelectOptions, selectedStyleDesc, aspectRatioOptions,
  novel, existingEpisodes, targetChars, splitTemplateId, splitTemplateOptions,
  splitting, splitProgress, splitError, preview, autoStart, fromEpisodeNumber, batchMode,
  batchTplIsParagraphs, batchTplParagraphs, singleTplIsParagraphs, singleTplParagraphs, estimatedEpisodes,
  onPickFile, createBatch, createAndUpload, startSplit, goDetail, finish, close,
} = useNovelWizard(emit)
</script>

<style scoped src="~/assets/styles/novel-wizard.css"></style>
