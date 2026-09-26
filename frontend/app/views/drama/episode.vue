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
  <div class="studio" v-if="drama">
    <EpisodeTopbar />

    <div class="studio-body">
    <!-- ========== LEFT SIDEBAR ========== -->
    <EpisodeSidebar />

    <!-- ========== MAIN CONTENT ========== -->
    <main class="main">
      <ScriptPanel v-if="panel === 'script'" />
      <ProductionPanel v-else-if="panel === 'production'" />
      <ExportPanel v-else />
      <TaskDrawer />
      <StepBubbleNav />
      <AssetDetailDialog />
      <ImageViewerDialog />
      <MergeViewerDialog />
      <AssetCreateDialog />
      <ConfirmDialogs />
      <StatsModals />
    </main>
    </div>
  </div>
  <!-- 初始加载占位：drama 未就绪时展示，避免白屏 -->
  <div v-else class="ep-init-loading">
    <Loader2 :size="22" class="animate-spin" />
    <span>加载中…</span>
  </div>
</template>

<script setup>
import { EPISODE_WB } from '~/composables/episode/workbench-context'
import { useEpisodeWorkbench } from '~/composables/episode/useEpisodeWorkbench'
import EpisodeTopbar from './episode/EpisodeTopbar.vue'
import EpisodeSidebar from './episode/EpisodeSidebar.vue'
import ScriptPanel from './episode/panels/ScriptPanel.vue'
import ProductionPanel from './episode/panels/ProductionPanel.vue'
import ExportPanel from './episode/panels/ExportPanel.vue'
import TaskDrawer from './episode/drawers/TaskDrawer.vue'
import StepBubbleNav from './episode/nav/StepBubbleNav.vue'
import AssetDetailDialog from './episode/dialogs/AssetDetailDialog.vue'
import ImageViewerDialog from './episode/dialogs/ImageViewerDialog.vue'
import MergeViewerDialog from './episode/dialogs/MergeViewerDialog.vue'
import AssetCreateDialog from './episode/dialogs/AssetCreateDialog.vue'
import ConfirmDialogs from './episode/dialogs/ConfirmDialogs.vue'
import StatsModals from './episode/dialogs/StatsModals.vue'
import { Loader2 } from 'lucide-vue-next'

const wb = useEpisodeWorkbench()
provide(EPISODE_WB, wb)
const {
  drama, panel,
} = wb
</script>

<style scoped src="~/assets/styles/episode/episode.base.css"></style>
<style scoped src="~/assets/styles/episode/shell.css"></style>
<style scoped>
.ep-init-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-secondary, #888);
  font-size: 13px;
  background: var(--bg-base, #fff);
}
</style>
