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
  通用下拉选择器：药丸触发钮 + 可搜索浮层，兼容扁平与分组两种选项形态
  浮层 Teleport 到 body 做 fixed 定位，样式整体外链 base-select.css
-->
<template>
  <div ref="rootEl" class="base-select">
    <button type="button" :disabled="disabled" :class="{ open: isOpen }" class="base-select-trigger" @click="toggle">
      <span class="base-select-label" :class="pickedLabel ? '' : 'placeholder'">{{ pickedLabel || placeholder }}</span>
      <ChevronDown :size="13" class="base-select-arrow" />
    </button>

    <Teleport to="body">
      <div v-if="isOpen" class="base-select-backdrop" @click="close" />
      <div v-if="isOpen" ref="dropdownEl" class="base-select-dropdown" :style="dropdownBox">
        <div v-if="searchable" class="base-select-search">
          <Search :size="12" />
          <input
            ref="searchInputEl"
            v-model="query"
            type="text"
            class="base-select-search-input"
            placeholder="搜索..."
            @keydown="onSearchKey"
          />
        </div>
        <div ref="optionsEl" class="base-select-options">
          <template v-if="flatList.length">
            <template v-for="(grp, gIdx) in shownGroups" :key="gIdx">
              <div v-if="grp.label" class="base-select-group-label">{{ grp.label }}</div>
              <button
                v-for="(opt, oIdx) in grp.options"
                :key="opt.value"
                type="button"
                :class="['base-select-option', { selected: opt.value === modelValue, highlighted: highlight === toFlat(gIdx, oIdx) }]"
                @click="pick(opt)"
                @mousemove="highlight = toFlat(gIdx, oIdx)"
              >{{ opt.label }}</button>
            </template>
          </template>
          <div v-else class="base-select-empty">无匹配结果</div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronDown, Search } from 'lucide-vue-next'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  // [{ label, value, group? }] 扁平表，或 [{ label, options: [...] }] 分组表
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '请选择...' },
  searchable: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const isOpen = ref(false)
const rootEl = ref()
const dropdownEl = ref()
const searchInputEl = ref()
const optionsEl = ref()
const query = ref('')
const highlight = ref(-1)
const dropdownBox = ref({})

// 统一成分组形态：原生分组直接用，扁平表按 group 字段分桶；
// 裸字符串选项按 label === value 归一
const normalizedGroups = computed(() => {
  if (!props.options.length) return []
  if (props.options[0]?.options) {
    return props.options.map(g => ({
      label: g.label || '',
      options: g.options.map(o => ({ label: o.label ?? o, value: o.value ?? o })),
    }))
  }
  const buckets = new Map()
  for (const o of props.options) {
    const key = o.group || ''
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push({ label: o.label ?? o, value: o.value ?? o })
  }
  return Array.from(buckets.entries()).map(([label, options]) => ({ label, options }))
})

// 搜索态只保留命中子串的项与非空桶
const shownGroups = computed(() => {
  if (!query.value) return normalizedGroups.value
  const q = query.value.toLowerCase()
  return normalizedGroups.value
    .map(g => ({
      label: g.label,
      options: g.options.filter(o => o.label.toLowerCase().includes(q)),
    }))
    .filter(g => g.options.length > 0)
})

// 键盘导航把二维分组压成一维序列
const flatList = computed(() => shownGroups.value.flatMap(g => g.options))

function toFlat(gIdx, oIdx) {
  let idx = 0
  for (let i = 0; i < gIdx; i++) idx += normalizedGroups.value[i].options.length
  return idx + oIdx
}

const pickedLabel = computed(() => {
  for (const g of normalizedGroups.value) {
    const hit = g.options.find(o => o.value === props.modelValue)
    if (hit) return hit.label
  }
  return ''
})

function toggle() {
  isOpen.value ? close() : open()
}

// 展开即定位、聚焦搜索框，并把高亮预置到当前选中项
async function open() {
  isOpen.value = true
  highlight.value = flatList.value.findIndex(o => o.value === props.modelValue)
  await nextTick()
  query.value = ''
  searchInputEl.value?.focus()
  alignDropdown()
}

function close() {
  isOpen.value = false
  query.value = ''
}

function pick(opt) {
  emit('update:modelValue', opt.value)
  close()
}

// 下方剩余空间 ≥120px 或不小于上方时向下展开，否则向上翻
function alignDropdown() {
  const rect = rootEl.value?.getBoundingClientRect()
  if (!rect) return
  const below = window.innerHeight - rect.bottom - 16
  const above = rect.top - 16
  const drop = below >= 120 || below >= above
  dropdownBox.value = {
    position: 'fixed',
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    maxHeight: `${Math.min(drop ? below : above, 400)}px`,
    ...(drop ? { top: `${rect.bottom + 4}px` } : { bottom: `${window.innerHeight - rect.top + 4}px` }),
  }
}

function onSearchKey(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    highlight.value = Math.min(highlight.value + 1, flatList.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    highlight.value = Math.max(highlight.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (highlight.value >= 0 && flatList.value[highlight.value]) {
      pick(flatList.value[highlight.value])
    }
  } else if (e.key === 'Escape') {
    close()
  }
}

// 展开期挂捕获阶段滚动监听保持贴合（浮层是 fixed，祖先滚动会错位）
watch(isOpen, val => {
  const fn = val ? document.addEventListener : document.removeEventListener
  fn('scroll', alignDropdown, true)
})

onBeforeUnmount(() => document.removeEventListener('scroll', alignDropdown, true))
</script>

<style scoped src="~/assets/styles/base-select.css"></style>
