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
  <div class="settings-page">
    <h1 v-if="!cfgPage" class="page-title">设置中心</h1>
    <div v-if="!cfgPage" class="settings-layout">
      <aside class="settings-nav">
        <div class="nav-group">
          <div class="nav-group-label">基础</div>
          <button v-for="t in baseTabs" :key="t.id" :class="['nav-item', { active: tab === t.id }]" @click="tab = t.id">
            <component :is="t.icon" :size="14" />
            {{ t.label }}
          </button>
        </div>
      </aside>

      <div class="settings-content">
        <!-- ===== AI 服务配置 ===== -->
        <SettingsAiPanel v-if="tab === 'ai'" />
        <!-- ===== 后台看门狗 ===== -->
        <SettingsWatchdogPanel v-else-if="tab === 'watchdogs'" class="settings-scroll" />
        <!-- ===== 风格预设 ===== -->
        <SettingsStylesPanel v-else-if="tab === 'styles'" />
      </div>
    </div>

    <!-- AI 配置独立编辑器 / 极简生成测试弹层（共享同一份页面状态） -->
    <SettingsCfgEditor v-if="cfgPage" />
    <SettingsGenTestDialog />

    <ConfirmDialog
      :open="!!styleToDelete"
      title="删除风格预设"
      :message="`确定删除风格「${styleToDelete?.name}」？已使用此风格的项目不受影响，但删除的内置风格重启后可能恢复，建议改用「停用」。`"
      :loading="deletingStyle"
      @confirm="confirmDelStyle"
      @cancel="styleToDelete = null"
    />
    <ConfirmDialog
      :open="aiCallConfirmingOff"
      title="关闭模型调用总开关"
      icon="warn"
      :message="aiCallOffMessage(aiCallActiveTasks)"
      confirm-text="仍要关闭"
      loading-text="关闭中..."
      :loading="aiCallSubmitting"
      @confirm="onAiCallOffConfirmed"
      @cancel="cancelAiCallOff"
    />
  </div>
</template>

<script setup>
import { Plus, Pencil, Trash2, Loader2, Cpu, Palette, Star, Power, AlertTriangle, TimerReset, Eye, EyeOff, Copy, ArrowLeft, FileText, Image, Video } from 'lucide-vue-next'
import SettingsAiPanel from '~/components/settings/SettingsAiPanel.vue'
import SettingsWatchdogPanel from '~/components/settings/SettingsWatchdogPanel.vue'
import SettingsStylesPanel from '~/components/settings/SettingsStylesPanel.vue'
import SettingsCfgEditor from '~/components/settings/SettingsCfgEditor.vue'
import SettingsGenTestDialog from '~/components/settings/SettingsGenTestDialog.vue'
import { useSettingsPage } from '~/composables/settings/useSettingsPage'

// 列表与独立表单复用配置逻辑，路径变化时重建页面，查询参数切换 Tab 不重建。
definePageMeta({ key: route => route.path })
const baseTabs = [
  { id: 'ai', label: 'AI 服务', icon: Cpu },
  { id: 'watchdogs', label: '后台看门狗', icon: TimerReset },
  { id: 'styles', label: '风格预设', icon: Palette },
]
// 页面级共享状态由门面 composable 持有并 provide 给各面板子组件。
const {
  tab, cfgPage,
  loadCfgs, loadStylePresets, loadCfgEditor, refreshAiCall, refreshWatchdogs,
  styleToDelete, deletingStyle, confirmDelStyle,
  aiCallConfirmingOff, aiCallSubmitting, aiCallActiveTasks, aiCallOffMessage,
  onAiCallOffConfirmed, cancelAiCallOff,
} = useSettingsPage()

onMounted(() => {
  if (cfgPage.value) loadCfgEditor()
  else { loadCfgs(); loadStylePresets(); refreshAiCall(); refreshWatchdogs() }
})
</script>

<style scoped src="assets/styles/settings.css"></style>
