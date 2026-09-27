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

<!--
  @ 引用文本域：透明 textarea 叠在高亮镜像层上，输入 @ 弹分组下拉选参考资产
  纯文本逻辑（HTML 高亮/光标坐标/引用识别）在 composables/useMentionTextarea
-->
<template>
  <div ref="wrapEl" class="mention-textarea">
    <!-- 镜像层与 textarea 渲染同一文本，只负责给 @引用 上色 -->
    <div ref="backdropEl" aria-hidden="true" :class="[inputClass, 'mention-backdrop']">
      <div class="mention-backdrop-content" v-html="highlightedHtml" />
    </div>
    <textarea
      ref="taEl"
      :rows="rows"
      :value="text"
      :placeholder="placeholder"
      :class="[inputClass, 'mention-input']"
      @click="closeMention"
      @blur="onBlur"
      @input="onInput"
      @scroll="onScroll"
      @keydown="onKeydown"
    />
    <Teleport to="body">
      <div v-if="mention.open" ref="dropdownEl" class="mention-dropdown" :style="mentionStyle">
        <template v-if="groupedOptions.length">
          <template v-for="(grp, gIdx) in groupedOptions" :key="grp.group">
            <div class="mention-group-label">{{ grp.group }}</div>
            <button
              v-for="(opt, oIdx) in grp.options"
              :key="grp.group + '-' + opt.value"
              type="button"
              :class="['mention-option', { highlighted: offsetOf(gIdx, oIdx) === highlightIdx }]"
              @mousedown.prevent="pick(opt)"
              @mousemove="highlightIdx = offsetOf(gIdx, oIdx)"
            >
              <span :class="['mention-avatar', avatarClass(opt.group)]">
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MapPin, Package, User } from 'lucide-vue-next'
import {
  detectActiveMention,
  getCaretCoordinates,
  mentionAfterCaret,
  mentionBeforeCaret,
  renderHighlightedHtml,
} from '~/composables/useMentionTextarea'

const props = defineProps({
  modelValue: { type: String, default: '' },
  // [{ label, value, group, image? }] — value 为插入的 @引用名
  options: { type: Array, default: () => [] },
  rows: { type: [Number, String], default: 4 },
  placeholder: { type: String, default: '' },
  inputClass: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'commit'])

const DROPDOWN_WIDTH = 240
const DROPDOWN_MAX_HEIGHT = 220

// 无图资产兜底图标：场景=定位、道具=包裹、其余按角色
const groupIcon = group => (group === '场景' ? MapPin : group === '道具' ? Package : User)
const avatarClass = group =>
  `mention-avatar-${group === '场景' ? 'scene' : group === '道具' ? 'prop' : 'role'}`

const wrapEl = ref(null)
const taEl = ref(null)
const backdropEl = ref(null)
const dropdownEl = ref(null)
const text = ref(props.modelValue)
const highlightIdx = ref(0)
const mention = ref({ open: false, start: 0, query: '', top: 0, left: 0 })

// 外部改写 modelValue 时同步文本并收起下拉
watch(() => props.modelValue, v => {
  if (v !== text.value) text.value = v
  mention.value.open = false
})

// 高亮项变化（键盘或鼠标）后滚进下拉可视区
watch(highlightIdx, () => {
  nextTick(() => {
    dropdownEl.value
      ?.querySelector('.mention-option.highlighted')
      ?.scrollIntoView({ block: 'nearest' })
  })
})

// 下拉 Teleport 后是 fixed 定位，外层任何滚动/缩放都会错位 → 直接收起
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

// 全文出现过的引用名（长名在前，保证最长匹配优先）
const mentionNames = computed(() => {
  const byName = new Map()
  for (const o of props.options) {
    if (o.value && !byName.has(o.value)) byName.set(o.value, o.group === '场景' ? 'scene' : 'role')
  }
  return [...byName.entries()].sort((a, b) => b[0].length - a[0].length)
})

// 镜像层 HTML：引用名套分组色彩 span，其他字符原样
const highlightedHtml = computed(() => renderHighlightedHtml(text.value, mentionNames.value))

// 查询串过滤（对 value 与 label 同时做子串匹配）
const filteredOptions = computed(() => {
  const q = mention.value.query.trim().toLowerCase()
  if (!q) return props.options
  return props.options.filter(o =>
    String(o.value).toLowerCase().includes(q) || String(o.label || '').toLowerCase().includes(q),
  )
})

// 按 group 字段分桶（缺桶名归入「参考」）
const groupedOptions = computed(() => {
  const buckets = []
  for (const opt of filteredOptions.value) {
    const name = opt.group || '参考'
    const hit = buckets.find(b => b.group === name)
    if (hit) hit.options.push(opt)
    else buckets.push({ group: name, options: [opt] })
  }
  return buckets
})

const flatList = computed(() => groupedOptions.value.flatMap(g => g.options))

// 组内序号 → 展平列表下标
function offsetOf(gIdx, oIdx) {
  let idx = 0
  for (let g = 0; g < gIdx; g++) idx += groupedOptions.value[g].options.length
  return idx + oIdx
}

// fixed 坐标基于视口；下方放不下且上方更宽裕时翻到光标上沿
const mentionStyle = computed(() => mention.value.above
  ? { left: `${mention.value.left}px`, bottom: `${window.innerHeight - mention.value.top}px` }
  : { left: `${mention.value.left}px`, top: `${mention.value.top}px` })

// 光标处正在输入的 @token 是否构成待弹状态
function refreshMention() {
  const ta = taEl.value
  const active = ta ? detectActiveMention(ta.value, ta.selectionStart) : null
  if (!active) { mention.value.open = false; return }
  // 已完整命中某个引用名（如删掉尾随空格后光标停在引用末尾）→ 不再弹列表
  if (mentionNames.value.some(([name]) => name === active.query)) {
    mention.value.open = false
    return
  }
  const caret = getCaretCoordinates(ta, ta.selectionStart)
  const rect = ta.getBoundingClientRect()
  const maxLeft = Math.max(0, (wrapEl.value?.clientWidth || DROPDOWN_WIDTH) - DROPDOWN_WIDTH)
  const belowTop = rect.top + caret.top + caret.lineHeight - ta.scrollTop + 4
  const above = belowTop + DROPDOWN_MAX_HEIGHT > window.innerHeight - 8 && caret.top > DROPDOWN_MAX_HEIGHT
  mention.value = {
    open: true,
    above,
    start: active.start,
    query: active.query,
    top: above ? rect.top + caret.top - ta.scrollTop - 4 : belowTop,
    left: rect.left + Math.min(caret.left, maxLeft),
  }
  highlightIdx.value = 0
}

function closeMention() {
  mention.value.open = false
}

// 程序化改文本：直写 textarea 原生值以保住光标控制，再回灌 v-model 与 commit
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
  refreshMention()
}

// 镜像层跟随 textarea 滚动；正文滚动会使 fixed 下拉错位 → 顺带收起
function onScroll() {
  if (backdropEl.value && taEl.value) {
    backdropEl.value.scrollTop = taEl.value.scrollTop
    backdropEl.value.scrollLeft = taEl.value.scrollLeft
  }
  closeMention()
}

function onKeydown(e) {
  const ta = taEl.value
  // 引用整体删除：光标紧贴完整引用尾/首时，退格/Delete 一次吃掉整段 @名称
  const atCaret = ta && e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && ta.selectionStart === ta.selectionEnd
  if (atCaret && (e.key === 'Backspace' || e.key === 'Delete')) {
    const hit = e.key === 'Backspace'
      ? mentionBeforeCaret(ta.value, ta.selectionStart, mentionNames.value)
      : mentionAfterCaret(ta.value, ta.selectionStart, mentionNames.value)
    if (hit) {
      e.preventDefault()
      setText(ta.value.slice(0, hit.start) + ta.value.slice(hit.end), hit.start)
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

// 选中下拉项：把 @token 替换成 `@名称 ` 并把光标放到插入尾部
function pick(opt) {
  const ta = taEl.value
  if (!ta) return
  const before = ta.value.slice(0, mention.value.start)
  const insert = `@${opt.value} `
  const next = before + insert + ta.value.slice(ta.selectionStart)
  setText(next, before.length + insert.length)
}

function onBlur(e) {
  closeMention()
  emit('commit', e.target.value)
}
</script>

<style scoped src="~/assets/styles/mention-textarea.css"></style>
