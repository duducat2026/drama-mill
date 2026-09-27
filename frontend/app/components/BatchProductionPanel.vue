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
  <div class="overlay" @click.self="close">
    <div class="dialog batch-dialog">
      <div class="dialog-head">
        <div class="wizard-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
        </div>
        <div class="dialog-head-copy">
          <h2 class="dialog-title">批量生产</h2>
          <p class="dialog-desc">多部小说按顺序编排，逐部完成分集与视频生产</p>
        </div>
        <button type="button" class="btn btn-icon" title="关闭" @click="close">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="batch-body">
        <div v-if="loading && !batches.length" class="batch-loading">
          <Loader2 :size="18" class="animate-spin" /> 加载中…
        </div>

        <div v-else-if="!batches.length" class="batch-empty">
          <p>暂无生产批次</p>
          <p class="batch-empty-desc">点击「导入文档」一次选择多部文档即可创建批次</p>
        </div>

        <template v-else>
          <!-- 批次选择 -->
          <div class="batch-picker">
            <button
              v-for="b in batches"
              :key="b.id"
              type="button"
              class="batch-chip"
              :class="{ on: b.id === selectedId }"
              @click="select(b.id)"
            >
              <span class="batch-chip-dot" :class="b.status"></span>
              #{{ b.id }} · {{ b.done }}/{{ b.total }}
              <span v-if="b.failed" class="batch-chip-failed">{{ b.failed }} 失败</span>
            </button>
          </div>

          <!-- 批次详情 -->
          <div v-if="detail" class="batch-detail">
            <div class="batch-detail-head">
              <span class="tag" :class="batchStatusClass(detail.status)">{{ batchStatusLabel(detail.status) }}</span>
              <span v-if="detail.mode === 'split_only'" class="tag tag-warn">两步 · 拆分后待确认生产</span>
              <span class="batch-summary">
                完成 {{ detail.counts.done }} / {{ detail.counts.total }}
                <template v-if="detail.counts.failed"> · 失败 {{ detail.counts.failed }}</template>
                <template v-if="detail.counts.pending"> · 排队 {{ detail.counts.pending }}</template>
                <template v-if="detail.counts.split_done"> · 拆分完成 {{ detail.counts.split_done }}（待生产）</template>
              </span>
              <div class="batch-actions">
                <button v-if="canProduce" type="button" class="btn btn-sm btn-primary" :disabled="acting" @click="doProduce">
                  <Loader2 v-if="acting === 'produce'" :size="12" class="animate-spin" />
                  启动生产（{{ detail.counts.split_done }} 项待生产）
                </button>
                <button v-if="canStart" type="button" class="btn btn-sm btn-primary" :disabled="acting" @click="doStart">
                  <Loader2 v-if="acting === 'start'" :size="12" class="animate-spin" />
                  {{ detail.status === 'paused' ? '继续' : detail.status === 'running' ? '' : (detail.counts.failed ? '重试失败项' : '启动') }}
                </button>
                <button v-if="detail.status === 'running'" type="button" class="btn btn-sm" :disabled="acting" @click="doPause">
                  <Loader2 v-if="acting === 'pause'" :size="12" class="animate-spin" />
                  暂停
                </button>
                <button v-if="detail.status === 'running' || detail.status === 'pending'" type="button" class="btn btn-sm batch-cancel" :disabled="acting" @click="doCancel">
                  <Loader2 v-if="acting === 'cancel'" :size="12" class="animate-spin" />
                  取消
                </button>
              </div>
            </div>

            <div class="batch-items">
              <div v-for="it in detail.items" :key="it.id" class="batch-item" :class="it.status">
                <span class="batch-item-seq">{{ it.seq }}</span>
                <div class="batch-item-main">
                  <div class="batch-item-title truncate" @click="openDrama(it.drama_id)">
                    {{ it.drama_title }}
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                      <path d="M7 17 17 7"/><path d="M7 7h10v10"/>
                    </svg>
                  </div>
                  <div class="batch-item-sub">
                    <span class="tag tag-sm" :class="itemStatusClass(it.status)">{{ itemStatusLabel(it) }}</span>
                    <span v-if="it.char_count" class="batch-item-chars">{{ it.char_count.toLocaleString() }} 字</span>
                    <span v-if="it.production?.current_step" class="batch-item-stage">
                      第 {{ it.production.current_episode_number }} 集 · {{ STEP_LABELS[it.production.current_step] || it.production.current_step }}
                    </span>
                  </div>
                  <div v-if="it.error" class="batch-item-error truncate" :title="it.error">{{ it.error }}</div>
                </div>
                <Loader2 v-if="it.status === 'splitting' || it.status === 'producing'" :size="14" class="animate-spin batch-item-spin" />
              </div>
            </div>
          </div>

          <!-- 速率配置实况 -->
          <div v-if="rate" class="batch-rate">
            <span>文本 AI {{ rate.text_ai.running }}/{{ rate.text_ai.max_concurrent }}</span>
            <span>图片 提交 {{ rate.generation_queue.by_type.image.running }}/{{ rate.generation_queue.by_type.image.max }} · 生成中 {{ rate.generation_queue.by_type.image.polling }}</span>
            <span>视频 提交 {{ rate.generation_queue.by_type.video.running }}/{{ rate.generation_queue.by_type.video.max }} · 生成中 {{ rate.generation_queue.by_type.video.polling }}</span>
            <span>排队 {{ rate.generation_queue.queued + rate.text_ai.queued }}</span>
            <span class="batch-rate-hint">各环节并发受平台速率配置约束（环境变量可调）</span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { Loader2 } from 'lucide-vue-next'
import { productionBatchAPI } from '~/composables/useApi'

const emit = defineEmits(['close'])

const STEP_LABELS = {
  script_rewrite: '剧本改写',
  extract_assets: '资产提取',
  storyboard_split: '分镜拆分',
  video_prompts: '视频提示词',
  asset_images: '资产图片',
  generate_videos: '视频生成',
}
const BATCH_STATUS = {
  pending: ['排队中', 'tag-default'],
  running: ['生产中', 'tag-success'],
  paused: ['已暂停', 'tag-warn'],
  done: ['已完成', 'tag-accent'],
  error: ['出错', 'tag-danger'],
  cancelled: ['已取消', 'tag-default'],
}
const ITEM_STATUS = {
  pending: '排队中',
  splitting: 'AI 分集中',
  split_failed: '分集失败',
  split_done: '拆分完成 · 待生产',
  producing: '视频生产中',
  done: '已完成',
  failed: '生产失败',
  cancelled: '已取消',
}

const loading = ref(false)
const batches = ref([])
const selectedId = ref(null)
const detail = ref(null)
const rate = ref(null)
const acting = ref('')
let pollTimer = null

const canStart = computed(() => detail.value && detail.value.mode !== 'split_only' && ['pending', 'paused', 'done', 'error', 'cancelled'].includes(detail.value.status))
// 两步走批次拆分完成即停，确认分集结果后手动启动生产（将 mode 改回 full 续接）
const canProduce = computed(() => detail.value && detail.value.mode === 'split_only' && detail.value.status !== 'running' && (detail.value.counts?.split_done || 0) > 0)

function batchStatusLabel(s) { return BATCH_STATUS[s]?.[0] || s }
function batchStatusClass(s) { return BATCH_STATUS[s]?.[1] || 'tag-default' }
function itemStatusLabel(it) { return ITEM_STATUS[it.status] || it.status }
function itemStatusClass(s) {
  if (s === 'done') return 'tag-success'
  if (s === 'failed' || s === 'split_failed') return 'tag-danger'
  if (s === 'splitting' || s === 'producing') return 'tag-accent'
  if (s === 'split_done') return 'tag-warn'
  return 'tag-default'
}

async function loadList() {
  try {
    batches.value = await productionBatchAPI.list()
    if (batches.value.length && !selectedId.value) {
      const running = batches.value.find(b => b.status === 'running' || b.status === 'pending')
      selectedId.value = running?.id || batches.value[0].id
    }
  } catch (e) {
    toast.error(e.message)
  }
}

async function loadDetail() {
  if (!selectedId.value) return
  try {
    detail.value = await productionBatchAPI.get(selectedId.value)
  } catch {
    detail.value = null
  }
}

async function loadRate() {
  try { rate.value = await productionBatchAPI.rateConfig() } catch {}
}

function select(id) {
  selectedId.value = id
  loadDetail()
}

async function doStart() {
  acting.value = 'start'
  try {
    await productionBatchAPI.start(selectedId.value)
    toast.success('批次已启动')
    await loadDetail()
  } catch (e) { toast.error(e.message) } finally { acting.value = '' }
}

// 两步走第二步：确认拆分结果后启动创作生产（后端将批次 mode 改回 full 再启动，幂等）
async function doProduce() {
  acting.value = 'produce'
  try {
    await productionBatchAPI.produce(selectedId.value)
    toast.success('已启动生产，将逐部续接图片/视频生成')
    await loadDetail()
    await loadList()
  } catch (e) { toast.error(e.message) } finally { acting.value = '' }
}

async function doPause() {
  acting.value = 'pause'
  try {
    await productionBatchAPI.pause(selectedId.value)
    toast.success('已请求暂停，当前部会在检查点停下')
    await loadDetail()
  } catch (e) { toast.error(e.message) } finally { acting.value = '' }
}

async function doCancel() {
  acting.value = 'cancel'
  try {
    await productionBatchAPI.cancel(selectedId.value)
    toast.success('批次已取消')
    await loadDetail()
    await loadList()
  } catch (e) { toast.error(e.message) } finally { acting.value = '' }
}

function openDrama(dramaId) {
  navigateTo(`/drama/${dramaId}`)
  emit('close')
}

function schedulePoll() {
  clearTimeout(pollTimer)
  const tick = async () => {
    const active = detail.value && ['running', 'pending', 'paused'].includes(detail.value.status)
    await loadDetail()
    if (active) await loadRate()
    await loadList()
    pollTimer = setTimeout(tick, active ? 5000 : 15000)
  }
  pollTimer = setTimeout(tick, 5000)
}

function close() { emit('close') }

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([loadList(), loadRate()])
    await loadDetail()
  } finally {
    loading.value = false
  }
  schedulePoll()
})

onBeforeUnmount(() => clearTimeout(pollTimer))
</script>

<style scoped src="~/assets/styles/batch-production.css"></style>
