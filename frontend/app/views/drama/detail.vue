<!--
  Drama Mill — AI 短剧生成平台
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
  <div class="page" v-if="drama">
    <!-- Header -->
    <div class="page-head card">
      <button class="back-btn" title="返回" @click="navigateTo('/')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>
      <div class="head-info">
        <div class="head-title-row">
          <h1 class="page-title">{{ drama.title }}</h1>
          <span v-if="drama.style" class="tag tag-accent">{{ drama.style }}</span>
        </div>
        <div class="page-meta">
          <span class="meta-item">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            {{ drama.characters?.length || 0 }} 角色
          </span>
          <span class="meta-item">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>
            {{ drama.scenes?.length || 0 }} 场景
          </span>
          <span class="meta-item">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.5"/><line x1="7" y1="8" x2="7" y2="16"/><line x1="10" y1="8" x2="10" y2="16"/><line x1="13" y1="8" x2="13" y2="16"/><line x1="16" y1="8" x2="16" y2="16"/></svg>
            {{ drama.episodes?.length || 0 }} 集
          </span>
        </div>
      </div>
      <div class="head-actions">
        <button
          type="button"
          :class="['btn', 'head-action', 'gnet-toggle', { on: greenNetFixOn }]"
          :disabled="togglingGreenNet"
          title="图片/视频生成被内容安全（绿网）拦截时，自动改写敏感提示词并重试"
          @click="toggleGreenNetFix"
        >
          <span class="gnet-dot"></span>
          绿网修正 · {{ greenNetFixOn ? '开' : '关' }}
        </button>
        <button class="btn btn-primary head-action" @click="eps.openAddEpisode">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          添加集
        </button>
      </div>
    </div>

    <!-- 主 Tab：剧集列表 / 素材库 -->
    <nav class="page-tabs">
      <button type="button" :class="['tab-btn', { on: activeTab === 'episodes' }]" @click="activeTab = 'episodes'">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.5"/><line x1="7" y1="8" x2="7" y2="16"/><line x1="10" y1="8" x2="10" y2="16"/><line x1="13" y1="8" x2="13" y2="16"/><line x1="16" y1="8" x2="16" y2="16"/></svg>
        剧集列表
        <span class="tab-count">{{ drama.episodes?.length || 0 }}</span>
      </button>
      <button type="button" :class="['tab-btn', { on: activeTab === 'assets' }]" @click="switchToAssets">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        素材库
        <span v-if="assets.assetTotal > 0" class="tab-count">{{ assets.assetTotal }}</span>
      </button>
    </nav>

    <!-- 自动化生产进度面板 -->
    <DetailProductionPanel :vm="prod" />

    <!-- 剧集列表 / 素材库（按主 Tab 切换） -->
    <DetailEpisodeList v-if="activeTab === 'episodes'" :drama="drama" :vm="eps" />
    <DetailAssetsPanel v-else-if="activeTab === 'assets'" :vm="assets" />
  </div>
  <!-- 初始加载占位：drama 未就绪时展示，避免白屏 -->
  <div v-else class="page-init-loading">
    <Loader2 :size="22" class="animate-spin" />
    <span>加载中…</span>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { Loader2 } from 'lucide-vue-next'
import { dramaAPI } from '~/composables/useApi'
import DetailProductionPanel from '~/views/drama/detail/panels/DetailProductionPanel.vue'
import DetailEpisodeList from '~/views/drama/detail/panels/DetailEpisodeList.vue'
import DetailAssetsPanel from '~/views/drama/detail/panels/DetailAssetsPanel.vue'
import { useDetailProduction } from '~/composables/detail/useDetailProduction'
import { useDetailEpisodes } from '~/composables/detail/useDetailEpisodes'
import { useDetailAssets } from '~/composables/detail/useDetailAssets'

const route = useRoute()
const drama = ref(null)
const dramaId = Number(route.params.id)

async function load() {
  try {
    drama.value = await dramaAPI.get(dramaId, { summary: true })
  } catch (e) {
    toast.error(e.message)
  }
}

// 绿网拦截自动修正开关：持久化在 dramas.metadata.green_net_auto_fix，默认开启
function parseDramaMetadata(raw) {
  if (!raw) return {}
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
const greenNetFixOn = computed(() => parseDramaMetadata(drama.value?.metadata).green_net_auto_fix !== false)
const togglingGreenNet = ref(false)

async function toggleGreenNetFix() {
  if (togglingGreenNet.value) return
  togglingGreenNet.value = true
  const next = !greenNetFixOn.value
  try {
    const meta = { ...parseDramaMetadata(drama.value?.metadata), green_net_auto_fix: next }
    await dramaAPI.update(dramaId, { metadata: meta })
    drama.value.metadata = JSON.stringify(meta)
    toast.success(next ? '已开启绿网拦截自动修正' : '已关闭绿网拦截自动修正')
  } catch (e) {
    toast.error(e.message)
  } finally {
    togglingGreenNet.value = false
  }
}

/* ===== 主 Tab 切换 ===== */
const activeTab = ref('episodes')
function switchToAssets() {
  activeTab.value = 'assets'
}

/* ===== 三个域面板的视图模型（逻辑已机械拆至 composables/detail/*） ===== */
const eps = useDetailEpisodes(dramaId, load)
const assets = useDetailAssets(dramaId, drama, load)
const prod = useDetailProduction(dramaId)

onMounted(load)
</script>

<style scoped src="assets/styles/drama.detail.css"></style>

<style scoped>
.page-init-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-secondary, #888);
  font-size: 13px;
  background: var(--bg-base, #fff);
  min-height: 50vh;
}
</style>
