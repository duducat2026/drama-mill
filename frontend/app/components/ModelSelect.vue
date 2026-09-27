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
  模型选择器：药丸触发钮 + Teleport 悬浮菜单的自绘弹层（非原生 select）
  选项 key 为 'configId::modelName' 复合键（无 configId 时退化为裸模型名）；
  '' 代表沿用配置默认模型；菜单挂 body 后样式不能 scoped
-->
<template>
  <div ref="rootEl" class="model-select">
    <span class="model-select-label">{{ label }}</span>
    <button type="button" :class="{ open: isOpen }" class="model-select-trigger" @click="toggle">
      <span v-if="picked?.provider" class="model-select-provider">{{ picked.provider }}</span>
      <span class="model-select-value">{{ shownText }}</span>
      <ChevronDown :size="11" class="model-select-arrow" />
    </button>

    <Teleport to="body">
      <div v-if="isOpen" class="model-select-backdrop" @click="close" />
      <div v-if="isOpen" ref="menuEl" class="model-select-menu" :style="menuBox">
        <button type="button" class="model-select-option" :class="{ selected: modelValue === '' }" @click="pick('')">
          <Check :size="12" class="opt-check" />
          <span class="opt-model dim">{{ defaultLabel }}</span>
        </button>
        <button
          v-for="opt in options"
          :key="opt.key || opt.model"
          type="button"
          class="model-select-option"
          :class="{ selected: modelValue === (opt.key || opt.model) }"
          @click="pick(opt.key || opt.model)"
        >
          <Check :size="12" class="opt-check" />
          <span class="opt-model">{{ opt.model }}</span>
          <span v-if="opt.provider" class="opt-provider">{{ opt.provider }}</span>
          <span v-if="showConfig" class="opt-config">{{ opt.configName }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'

const props = defineProps({
  // 选择器标题：改写 / 图片 / 视频
  label: { type: String, required: true },
  // '' = 配置默认；选中值为 'provider/model' 或 'configId::model' 复合键
  modelValue: { type: String, default: '' },
  // [{ key, model, provider, configId, configName }]
  options: { type: Array, default: () => [] },
  defaultLabel: { type: String, default: '默认' },
  // 同一模型挂在多个配置下时，标注来源配置名
  showConfig: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const isOpen = ref(false)
const rootEl = ref()
const menuEl = ref()
const menuBox = ref({})

const picked = computed(() =>
  props.options.find(o => (o.key || o.model) === props.modelValue) || null)
const shownText = computed(() => picked.value?.model || props.defaultLabel)

function toggle() {
  isOpen.value ? close() : open()
}

// 展开后按触发钮矩形定位菜单，并把当前选中项滚入视口
async function open() {
  isOpen.value = true
  await nextTick()
  alignMenu()
  menuEl.value?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' })
}

function close() { isOpen.value = false }

function pick(model) {
  emit('update:modelValue', model)
  close()
}

// 宽度不小于触发钮，右侧越界时向左回缩，底部空间不足则限制最大高
function alignMenu() {
  const box = rootEl.value?.getBoundingClientRect()
  if (!box) return
  const width = Math.max(box.width, 240)
  const left = Math.min(box.left, window.innerWidth - width - 12)
  menuBox.value = {
    position: 'fixed',
    top: `${box.bottom + 6}px`,
    left: `${Math.max(12, left)}px`,
    minWidth: `${width}px`,
    maxHeight: `${Math.min(window.innerHeight - box.bottom - 20, 340)}px`,
  }
}

function onKeydown(e) {
  if (e.key === 'Escape') close()
}

// 展开期挂滚动（捕获阶段）与 Esc 监听，收起/卸载时对称摘除
function bindLayer(listen) {
  const fn = listen ? document.addEventListener : document.removeEventListener
  fn('scroll', alignMenu, true)
  fn('keydown', onKeydown)
}

watch(isOpen, val => bindLayer(val))
onBeforeUnmount(() => bindLayer(false))
</script>

<style scoped>
.model-select { display: flex; align-items: center; gap: 6px; }
.model-select-label { font: 600 11px var(--font-body); color: var(--text-3); }
.model-select-trigger {
  display: flex; align-items: center; gap: 6px;
  height: 26px; max-width: 210px; padding: 0 8px 0 10px;
  font: 11px var(--font-body); color: var(--text-1);
  background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 999px;
  cursor: pointer; transition: border-color .16s, box-shadow .16s, background .16s;
}
.model-select-trigger:hover { border-color: rgba(0,0,0,0.22); }
.model-select-trigger.open,
.model-select-trigger:focus-visible {
  outline: none; border-color: var(--border-focus); box-shadow: 0 0 0 3px var(--button-focus);
}
.model-select-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.model-select-provider {
  flex-shrink: 0; padding: 1px 5px; border-radius: 4px;
  font: 600 9px var(--font-body); letter-spacing: .02em; text-transform: uppercase;
  color: var(--accent, #0071e3); background: var(--accent-bg, rgba(0,113,227,0.10));
}
.model-select-arrow { flex-shrink: 0; color: var(--text-3); transition: transform .18s var(--ease-out); }
.model-select-trigger.open .model-select-arrow { transform: rotate(180deg); }
</style>

<!-- 菜单与遮罩被 Teleport 出组件根，样式走全局层 -->
<style>
.model-select-backdrop { position: fixed; inset: 0; z-index: 990; }
.model-select-menu {
  z-index: 991; display: flex; flex-direction: column; gap: 1px; padding: 5px;
  overflow-y: auto; border: 1px solid var(--border); border-radius: 12px;
  background: var(--bg-1, #fff); box-shadow: 0 12px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.06);
  animation: modelMenuIn .16s var(--ease-out, ease-out);
}
@keyframes modelMenuIn {
  from { opacity: 0; transform: translateY(-4px) scale(0.98); }
  to { opacity: 1; transform: none; }
}
.model-select-option {
  display: flex; align-items: center; gap: 7px; width: 100%;
  padding: 7px 9px; border: none; border-radius: 8px; text-align: left;
  background: transparent; color: var(--text-1); font: 12px var(--font-body);
  cursor: pointer; transition: background .12s;
}
.model-select-option:hover { background: var(--accent-bg, rgba(0,113,227,0.08)); }
.model-select-option .opt-check { flex-shrink: 0; opacity: 0; color: var(--accent, #0071e3); }
.model-select-option.selected .opt-check { opacity: 1; }
.model-select-option.selected .opt-model { font-weight: 600; color: var(--text-0); }
.model-select-option .opt-model { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.model-select-option .opt-model.dim { color: var(--text-3); }
.model-select-option .opt-provider {
  flex-shrink: 0; margin-left: auto; padding: 1px 5px; border-radius: 4px;
  font: 600 9px var(--font-body); letter-spacing: .02em; text-transform: uppercase;
  color: var(--text-3); background: var(--bg-3, rgba(0,0,0,0.06));
}
.model-select-option .opt-config { flex-shrink: 0; font-size: 10px; color: var(--text-3); }
</style>
