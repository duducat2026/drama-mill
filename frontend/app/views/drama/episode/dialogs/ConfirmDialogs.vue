<!--
  Drama Mill — episode 工作台子组件（自 views/drama/episode.vue 机械拆分，模板与逻辑逐字保留）
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
      <ConfirmDialog
        :open="assetDelete.open"
        :title="`删除${assetDeleteTypeLabel}`"
        :message="`确定删除${assetDeleteTypeLabel}「${assetDeleteName}」吗？将从本剧所有集中移除。`"
        :loading="assetDelete.loading"
        @confirm="confirmDeleteAsset"
        @cancel="assetDelete.open = false"
      />

      <ConfirmDialog
        :open="!!mergeToDelete"
        title="删除成片"
        :message="`确定删除 ${formatHistoryTime(mergeToDelete?.created_at)} 生成的成片吗？视频文件将被永久移除，不可恢复。`"
        :loading="mergeDeleteLoading"
        @confirm="confirmDeleteMerge"
        @cancel="mergeToDelete = null"
      />

      <!-- 关闭模型调用总开关：二次确认，并提示本人在途任务数（关闭会让排队/自动重提任务判失败）-->
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
</template>

<script setup>
import { EPISODE_WB } from '~/composables/episode/workbench-context'

const wb = inject(EPISODE_WB)
const {
  assetDelete, assetDeleteTypeLabel, assetDeleteName, confirmDeleteAsset,
  mergeToDelete, formatHistoryTime, mergeDeleteLoading, confirmDeleteMerge,
  aiCallConfirmingOff, aiCallActiveTasks, aiCallSubmitting,
  onAiCallOffConfirmed, cancelAiCallOff,
} = wb
</script>

<style scoped src="~/assets/styles/episode/episode.base.css"></style>
<style scoped src="~/assets/styles/episode/dialogs.css"></style>
