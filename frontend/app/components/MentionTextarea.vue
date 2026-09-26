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
  <div class="mention-textarea" ref="wrapEl">
    <!-- 高亮镜像层：渲染与 textarea 完全相同的文本，@引用 着彩色；textarea 文字透明、仅显示光标 -->
    <div ref="backdropEl" :class="[inputClass, 'mention-backdrop']" aria-hidden="true">
      <div class="mention-backdrop-content" v-html="highlightedHtml"></div>
    </div>
    <textarea
      ref="taEl"
      :class="[inputClass, 'mention-input']"
      :rows="rows"
      :placeholder="placeholder"
      :value="text"
      @input="onInput"
      @keydown="onKeydown"
      @blur="onBlur"
      @click="closeMention"
      @scroll="onScroll"
    />
    <Teleport to="body">
      <div v-if="mention.open" ref="dropdownEl" class="mention-dropdown" :style="mentionStyle">
        <template v-if="groupedFiltered.length">
          <template v-for="(group, gi) in groupedFiltered" :key="group.group">
            <div class="mention-group-label">{{ group.group }}</div>
            <button
              v-for="(opt, oi) in group.options"
              :key="group.group + '-' + opt.value"
              type="button"
              :class="['mention-option', { highlighted: flatIndex(gi, oi) === highlightIdx }]"
              @mousedown.prevent="pick(opt)"
              @mousemove="highlightIdx = flatIndex(gi, oi)"
            >
              <span :class="['mention-avatar', `mention-avatar-${opt.group === '场景' ? 'scene' : (opt.group === '道具' ? 'prop' : 'role')}`]">
                <img v-if="opt.image" :src="opt.image" alt="" @error="$event.target.style.display = 'none'" />
                <component v-else :is="groupIcon(opt.group)" :size="12" :stroke-width="2" />
              </span>
              <span class="mention-name">@{{ opt.label }}</span>
              <span class="mention-type">{{ opt.group }}</span>
            </button>
          </template>
        </template>
        <div v-else class="mention-empty">无匹配的参考</div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { User, MapPin, Package } from 'lucide-vue-next'
import {
  renderHighlightedHtml,
  detectActiveMention,
  mentionBeforeCaret,
  mentionAfterCaret,
  getCaretCoordinates,
} from '~/composables/useMentionTextarea'

// 无图资产在下拉中显示分组图标兜底（场景=定位、道具=包裹、角色=人物）
const groupIcon = (group) => (group === '场景' ? MapPin : group === '道具' ? Package : User)

const props = defineProps({
  modelValue: { type: String, default: '' },
  // [{ label, value, group, image? }] — value 为插入的 @引用名
  options: { type: Array, default: () => [] },
  rows: { type: [Number, String], default: 4 },
  placeholder: { type: String, default: '' },
  inputClass: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'commit'])

const wrapEl = ref(null)
const taEl = ref(null)
const backdropEl = ref(null)
const text = ref(props.modelValue)
const mention = ref({ open: false, start: 0, query: '', top: 0, left: 0 })
const highlightIdx = ref(0)
const dropdownEl = ref(null)

// 键盘上下移动高亮时，让高亮项自动滚动进下拉可视区（鼠标 mousemove 触发的跳转也保持可见）
watch(highlightIdx, () => {
  nextTick(() => {
    dropdownEl.value
      ?.querySelector('.mention-option.highlighted')
      ?.scrollIntoView({ block: 'nearest' })
  })
})

const DROPDOWN_WIDTH = 240
const DROPDOWN_MAX_HEIGHT = 220

// 下拉 Teleport 到 body 后用 fixed 定位，任何外层滚动/窗口变化都会使其错位 → 直接关闭
function closeOnOuterScroll(e) {
  if (mention.value.open && e?.target !== taEl.value) closeMention()
}
onMounted(() => {
  window.addEventListener('scroll', closeOnOuterScroll, true)
  window.addEventListener('resize', closeOnOuterScroll)
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', closeOnOuterScroll, true)
  window.removeEventListener('resize', closeOnOuterScroll)
})

watch(() => props.modelValue, (v) => {
  if (v !== text.value) text.value = v
  mention.value.open = false
})

// 可引用名（按长度降序，保证最长匹配优先）及其分组样式
const mentionNames = computed(() => {
  const seen = new Map()
  for (const o of props.options) {
    if (o.value && !seen.has(o.value)) seen.set(o.value, o.group === '场景' ? 'scene' : 'role')
  }
  return [...seen.entries()].sort((a, b) => b[0].length - a[0].length)
})

// 镜像层高亮 HTML：@引用 包上分组色彩 span，其余文本原样
const highlightedHtml = computed(() => renderHighlightedHtml(text.value, mentionNames.value))

const filteredOptions = computed(() => {
  const q = mention.value.query.trim().toLowerCase()
  if (!q) return props.options
  return props.options.filter(o =>
    String(o.value).toLowerCase().includes(q) || String(o.label || '').toLowerCase().includes(q),
  )
})

const groupedFiltered = computed(() => {
  const groups = []
  for (const opt of filteredOptions.value) {
    const name = opt.group || '参考'
    const g = groups.find(item => item.group === name)
    if (g) g.options.push(opt)
    else groups.push({ group: name, options: [opt] })
  }
  return groups
})

const flatList = computed(() => groupedFiltered.value.flatMap(g => g.options))

function flatIndex(gi, oi) {
  let idx = 0
  for (let g = 0; g < gi; g++) idx += groupedFiltered.value[g].options.length
  return idx + oi
}

// 下拉为 fixed 定位（Teleport 到 body），坐标基于视口；下方空间不足时翻到光标上方
const mentionStyle = computed(() => mention.value.above
  ? { left: `${mention.value.left}px`, bottom: `${window.innerHeight - mention.value.top}px` }
  : { left: `${mention.value.left}px`, top: `${mention.value.top}px` })

function updateMentionState() {
  const el = taEl.value
  const active = el ? detectActiveMention(el.value, el.selectionStart) : null
  if (!active) { mention.value.open = false; return }
  // @后文本已精确等于某个完整引用名时不再弹列表（如删除引用尾部空格后光标落在完整引用上）
  if (mentionNames.value.some(([name]) => name === active.query)) {
    mention.value.open = false
    return
  }
  const ta = taEl.value
  const caret = getCaretCoordinates(ta, ta.selectionStart)
  const rect = ta.getBoundingClientRect()
  const maxLeft = Math.max(0, (wrapEl.value?.clientWidth || DROPDOWN_WIDTH) - DROPDOWN_WIDTH)
  const belowTop = rect.top + caret.top + caret.lineHeight - ta.scrollTop + 4
  // 下方放不下时下拉翻到光标上方（top 记为光标行的视口上沿）
  const above = belowTop + DROPDOWN_MAX_HEIGHT > window.innerHeight - 8 && caret.top > DROPDOWN_MAX_HEIGHT
  mention.value = {
    open: true,
    start: active.start,
    query: active.query,
    top: above ? rect.top + caret.top - ta.scrollTop - 4 : belowTop,
    left: rect.left + Math.min(caret.left, maxLeft),
    above,
  }
  highlightIdx.value = 0
}

function closeMention() {
  mention.value.open = false
}

function setText(next, caret) {
  const ta = taEl.value
  if (ta) {
    ta.value = next
    ta.focus()
    if (caret != null) ta.setSelectionRange(caret, caret)
  }
  text.value = next
  closeMention()
  emit('update:modelValue', next)
  emit('commit', next)
}

function onInput(e) {
  text.value = e.target.value
  emit('update:modelValue', e.target.value)
  updateMentionState()
}

function onScroll() {
  if (backdropEl.value && taEl.value) {
    backdropEl.value.scrollTop = taEl.value.scrollTop
    backdropEl.value.scrollLeft = taEl.value.scrollLeft
  }
  closeMention()
}

function onKeydown(e) {
  const ta = taEl.value
  // @引用整体删除：光标在完整引用后按退格 / 在完整引用前按 Delete，整段一次删除
  if (ta && (e.key === 'Backspace' || e.key === 'Delete') && ta.selectionStart === ta.selectionEnd) {
    const hit = e.key === 'Backspace'
      ? mentionBeforeCaret(ta.value, ta.selectionStart, mentionNames.value)
      : mentionAfterCaret(ta.value, ta.selectionStart, mentionNames.value)
    if (hit) {
      e.preventDefault()
      const next = ta.value.slice(0, hit.start) + ta.value.slice(hit.end)
      setText(next, hit.start)
      return
    }
  }
  if (!mention.value.open) return
  const total = flatList.value.length
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (total) highlightIdx.value = (highlightIdx.value + 1) % total
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (total) highlightIdx.value = (highlightIdx.value - 1 + total) % total
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    if (total) {
      e.preventDefault()
      pick(flatList.value[highlightIdx.value] || flatList.value[0])
    }
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closeMention()
  }
}

function pick(opt) {
  const ta = taEl.value
  if (!ta) return
  const pos = ta.selectionStart
  const before = ta.value.slice(0, mention.value.start)
  const after = ta.value.slice(pos)
  const insert = `@${opt.value} `
  const next = before + insert + after
  setText(next, before.length + insert.length)
}

function onBlur(e) {
  closeMention()
  emit('commit', e.target.value)
}
</script>

<style scoped src="~/assets/styles/mention-textarea.css"></style>
