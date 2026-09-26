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
  <div class="base-select" ref="rootEl">
    <!-- Trigger -->
    <button type="button" class="base-select-trigger" :class="{ open: isOpen }" :disabled="disabled" @click="toggle">
      <span :class="selectedLabel ? '' : 'placeholder'" class="base-select-label">{{ selectedLabel || placeholder }}</span>
      <ChevronDown :size="13" class="base-select-arrow" />
    </button>

    <!-- Dropdown -->
    <Teleport to="body">
      <div v-if="isOpen" class="base-select-dropdown" :style="dropdownStyle" ref="dropdownEl">
        <!-- Search -->
        <div v-if="searchable" class="base-select-search">
          <Search :size="12" />
          <input
            ref="searchInputEl"
            v-model="searchQuery"
            class="base-select-search-input"
            placeholder="搜索..."
            @keydown="onSearchKeydown"
          />
        </div>

        <!-- Options -->
        <div class="base-select-options" ref="optionsEl">
          <template v-if="flatOptions.length">
            <template v-for="(group, gi) in filteredGroups" :key="gi">
              <div v-if="group.label" class="base-select-group-label">{{ group.label }}</div>
              <button
                v-for="(opt, oi) in group.options"
                :key="opt.value"
                type="button"
                :class="['base-select-option', { selected: opt.value === modelValue, highlighted: highlightedIdx === getGlobalIdx(gi, oi) }]"
                @click="pick(opt)"
                @mousemove="highlightedIdx = getGlobalIdx(gi, oi)"
              >{{ opt.label }}</button>
            </template>
          </template>
          <div v-else class="base-select-empty">无匹配结果</div>
        </div>
      </div>
    </Teleport>

    <!-- Backdrop -->
    <Teleport to="body">
      <div v-if="isOpen" class="base-select-backdrop" @click="isOpen = false" />
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { ChevronDown, Search } from 'lucide-vue-next'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] }, // [{ label, value, group? }, ...] or [{ label, group, options: [] }]
  placeholder: { type: String, default: '请选择...' },
  searchable: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const isOpen = ref(false)
const searchQuery = ref('')
const rootEl = ref()
const dropdownEl = ref()
const searchInputEl = ref()
const optionsEl = ref()
const highlightedIdx = ref(-1)
const dropdownStyle = ref({})

// Normalize options: support both flat list and grouped format
const normalizedGroups = computed(() => {
  if (!props.options.length) return []
  // Check if already grouped
  if (props.options[0]?.options) {
    return props.options.map(g => ({
      label: g.label || '',
      options: g.options.map(o => ({ label: o.label ?? o, value: o.value ?? o })),
    }))
  }
  // Flat list with optional group property
  const map = new Map()
  for (const o of props.options) {
    const label = o.group || ''
    if (!map.has(label)) map.set(label, [])
    map.get(label).push({ label: o.label ?? o, value: o.value ?? o })
  }
  return Array.from(map.entries()).map(([label, options]) => ({ label, options }))
})

// Filter by search query
const filteredGroups = computed(() => {
  if (!searchQuery.value) return normalizedGroups.value
  const q = searchQuery.value.toLowerCase()
  return normalizedGroups.value
    .map(g => ({
      label: g.label,
      options: g.options.filter(o => o.label.toLowerCase().includes(q)),
    }))
    .filter(g => g.options.length > 0)
})

// Flatten for keyboard nav
const flatOptions = computed(() => filteredGroups.value.flatMap(g => g.options))

function getGlobalIdx(gi, oi) {
  let idx = 0
  for (let i = 0; i < gi; i++) idx += normalizedGroups.value[i].options.length
  return idx + oi
}

function resolveIdx(globalIdx) {
  for (let gi = 0; gi < filteredGroups.value.length; gi++) {
    const cnt = filteredGroups.value[gi].options.length
    if (globalIdx < cnt) return [gi, globalIdx]
    globalIdx -= cnt
  }
  return [0, 0]
}

const selectedLabel = computed(() => {
  for (const g of normalizedGroups.value) {
    const found = g.options.find(o => o.value === props.modelValue)
    if (found) return found.label
  }
  return ''
})

function toggle() {
  isOpen.value ? close() : open()
}

async function open() {
  isOpen.value = true
  highlightedIdx.value = flatOptions.value.findIndex(o => o.value === props.modelValue)
  await nextTick()
  searchQuery.value = ''
  searchInputEl.value?.focus()
  positionDropdown()
}

function close() {
  isOpen.value = false
  searchQuery.value = ''
}

function pick(opt) {
  emit('update:modelValue', opt.value)
  close()
}

function positionDropdown() {
  const rect = rootEl.value?.getBoundingClientRect()
  if (!rect) return
  const spaceBelow = window.innerHeight - rect.bottom - 16
  const spaceAbove = rect.top - 16
  // 下方空间充足或比上方大时向下弹出，否则向上弹出
  if (spaceBelow >= 120 || spaceBelow >= spaceAbove) {
    dropdownStyle.value = {
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      maxHeight: `${Math.min(spaceBelow, 400)}px`,
    }
  } else {
    dropdownStyle.value = {
      position: 'fixed',
      bottom: `${window.innerHeight - rect.top + 4}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      maxHeight: `${Math.min(spaceAbove, 400)}px`,
    }
  }
}

function onSearchKeydown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    highlightedIdx.value = Math.min(highlightedIdx.value + 1, flatOptions.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    highlightedIdx.value = Math.max(highlightedIdx.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (highlightedIdx.value >= 0 && flatOptions.value[highlightedIdx.value]) {
      pick(flatOptions.value[highlightedIdx.value])
    }
  } else if (e.key === 'Escape') {
    close()
  }
}

watch(isOpen, val => {
  if (val) document.addEventListener('scroll', positionDropdown, true)
  else document.removeEventListener('scroll', positionDropdown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('scroll', positionDropdown, true)
})
</script>

<style scoped src="~/assets/styles/base-select.css"></style>
