<!--
  Drama Mill — episode 工作台子组件（自 views/drama/episode.vue 机械拆分，模板与逻辑逐字保留）
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
      <div v-if="assetCreate.open" class="overlay" @click.self="assetCreate.open = false">
        <div class="dialog asset-create-dialog">
          <header class="dialog-head">
            <h2 class="dialog-title">新增{{ assetCreateTypeLabel }}</h2>
            <button class="btn btn-ghost btn-icon" @click="assetCreate.open = false">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </header>
          <div class="dialog-body asset-create-body">
            <template v-if="assetCreate.type === 'character'">
              <label class="field"><span class="field-label">名称</span><input v-model="assetCreateDraft.name" class="input" placeholder="角色名称" /></label>
              <label class="field"><span class="field-label">角色定位</span><input v-model="assetCreateDraft.role" class="input" placeholder="如：主角 / 反派 / 配角" /></label>
              <label class="field"><span class="field-label">样貌</span><textarea v-model="assetCreateDraft.appearance" class="textarea" rows="3" placeholder="外貌特征（可融入性格）" /></label>
              <label class="field"><span class="field-label">妆造</span><textarea v-model="assetCreateDraft.styling" class="textarea" rows="2" placeholder="服装、妆容、配饰" /></label>
            </template>
            <template v-else-if="assetCreate.type === 'scene'">
              <label class="field"><span class="field-label">地点</span><input v-model="assetCreateDraft.location" class="input" placeholder="场景地点" /></label>
              <label class="field"><span class="field-label">时间</span><input v-model="assetCreateDraft.time" class="input" placeholder="如：白天 / 夜晚" /></label>
              <label class="field"><span class="field-label">场景描述</span><textarea v-model="assetCreateDraft.prompt" class="textarea" rows="3" placeholder="环境、陈设、氛围" /></label>
              <label class="field"><span class="field-label">场景光影</span><input v-model="assetCreateDraft.lighting" class="input" placeholder="如：黄昏暖光、冷清顶光" /></label>
            </template>
            <template v-else>
              <label class="field"><span class="field-label">名称</span><input v-model="assetCreateDraft.name" class="input" placeholder="道具名称" /></label>
              <label class="field"><span class="field-label">类型</span><input v-model="assetCreateDraft.type" class="input" placeholder="如：武器 / 信物 / 文件" /></label>
              <label class="field"><span class="field-label">物品外貌</span><textarea v-model="assetCreateDraft.description" class="textarea" rows="3" placeholder="只描述物品的外观，与其他无关" /></label>
            </template>
          </div>
          <footer class="dialog-foot">
            <button class="btn" @click="assetCreate.open = false">取消</button>
            <button class="btn btn-primary" :disabled="assetCreate.saving" @click="saveAssetCreate">
              <Loader2 v-if="assetCreate.saving" :size="12" class="animate-spin" />
              新增
            </button>
          </footer>
        </div>
      </div>
</template>

<script setup>
import { EPISODE_WB } from '~/composables/episode/workbench-context'
import { Loader2 } from 'lucide-vue-next'

const wb = inject(EPISODE_WB)
const {
  assetCreate, assetCreateTypeLabel, assetCreateDraft, saveAssetCreate,
} = wb
</script>

<style scoped src="~/assets/styles/episode/episode.base.css"></style>
<style scoped src="~/assets/styles/episode/dialogs.css"></style>
