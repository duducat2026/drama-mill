<template>
  <!-- 素材库 -->
  <div class="assets-wrap">
    <div class="seg asset-filter">
      <button
        v-for="t in assetTabs"
        :key="t.value"
        type="button"
        class="seg-item"
        :class="{ on: assetTab === t.value }"
        @click="assetTab = t.value"
      >{{ t.label }}</button>
    </div>

    <!-- 全部素材为空 -->
    <div v-if="!materials.length" class="empty-state">
      <div class="empty-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
        </svg>
      </div>
      <p class="empty-title">还没有任何素材</p>
      <p class="empty-desc">在剧情工作台中通过「提取资产」生成角色、场景与道具后，会自动收录到这里，并可直接生成素材图。</p>
    </div>

    <div v-else-if="materials.length" class="asset-groups">
      <template v-for="g in assetGroups" :key="g.kindKey">
        <template v-if="g.items.length">
          <div v-if="assetTab === 'all'" class="asset-group-head" :class="tagClass(g.kindKey)">
            <span class="group-icon">
              <svg v-if="g.kindKey === 'character'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <svg v-else-if="g.kindKey === 'scene'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.27 6.96 12 12l8.73-5.04M12 22.08V12"/></svg>
            </span>
            <span class="group-label">{{ g.label }}</span>
            <span class="group-count">{{ g.items.length }}</span>
          </div>

          <!-- 角色：横向布局卡片（头像 + 样貌/妆造 + 三视图提示词） -->
          <div v-if="g.kindKey === 'character'" class="character-asset-grid">
            <article
              v-for="m in g.items"
              :key="'character-' + m.id"
              class="card character-asset-card"
              tabindex="0"
              role="button"
              @click="openEdit(m)"
              @keydown.enter.prevent="openEdit(m)"
              @keydown.space.prevent="openEdit(m)"
            >
              <div class="character-asset-main">
                <div class="character-asset-overview">
                  <div class="character-portrait">
                    <img v-if="matHasImage(m)" :src="thumbOf(assetSrc(m))" class="previewable-image" loading="lazy" @error="thumbFallback($event, assetSrc(m))" @click.stop="openAssetViewer(m)" />
                    <div v-else class="character-portrait-empty">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </div>
                    <span class="asset-cover-badge" :class="matHasImage(m) ? 'is-ready' : (isPending(m) ? 'is-pending' : '')">
                      {{ matHasImage(m) ? '形象已生成' : (isPending(m) ? '形象生成中' : '形象待生成') }}
                    </span>
                  </div>
                  <div class="character-asset-head">
                    <div class="character-title-block">
                      <div class="character-name-row">
                        <strong class="character-name">{{ m.name }}</strong>
                        <span class="tag">{{ m.role || '角色' }}</span>
                      </div>
                      <div class="character-visual-summary" :title="matDesc(m)">
                        <span>样貌：{{ m.appearance || '待补充' }}</span>
                        <span>妆造：{{ m.styling || '待补充' }}</span>
                      </div>
                    </div>
                    <button class="btn btn-sm character-gen-btn" type="button" :disabled="isPending(m)" @click.stop="generateMaterial(m)">
                      <span v-if="isPending(m)" class="ring-spinner sm"></span>
                      {{ matHasImage(m) ? '重绘' : (isPending(m) ? '生成中' : '生成') }}
                    </button>
                    <button class="btn btn-sm" type="button" title="上传角色形象图" :disabled="isUploading(m)" @click.stop="uploadMaterial(m)">
                      <span v-if="isUploading(m)" class="ring-spinner sm"></span>
                      <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      上传
                    </button>
                  </div>
                </div>
                <div class="asset-final-prompt" :title="m.finalPrompt || ''">
                  <span class="afp-label">最终提示词 · 三视图</span>
                  <span :class="['afp-text', !m.finalPrompt && 'dim']">{{ m.finalPrompt || '首次生成形象时由提示词 Agent 自动生成' }}</span>
                </div>
              </div>
            </article>
          </div>

          <!-- 场景 / 道具：竖向布局卡片（封面 + 描述/光影/类型 + 最终提示词 + 底部状态） -->
          <div v-else class="asset-grid">
            <div
              v-for="m in g.items"
              :key="g.kindKey + '-' + m.id"
              :class="['card', 'asset-card', 'asset-click-card', g.kindKey === 'prop' ? 'prop-card' : '']"
              tabindex="0"
              role="button"
              @click="openEdit(m)"
              @keydown.enter.prevent="openEdit(m)"
              @keydown.space.prevent="openEdit(m)"
            >
              <div class="asset-cover wide">
                <img v-if="matHasImage(m)" :src="thumbOf(assetSrc(m))" class="previewable-image" loading="lazy" @error="thumbFallback($event, assetSrc(m))" @click.stop="openAssetViewer(m)" />
                <div v-else class="asset-cover-empty">
                  <svg v-if="g.kindKey === 'scene'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                </div>
                <span class="asset-cover-badge" :class="matHasImage(m) ? 'is-ready' : (isPending(m) ? 'is-pending' : '')">
                  {{ matHasImage(m) ? '已生成' : (isPending(m) ? '生成中' : '待生成') }}
                </span>
              </div>
              <div class="asset-body">
                <template v-if="g.kindKey === 'scene'">
                  <div class="asset-name" :title="m.location">{{ m.location }}</div>
                  <div class="asset-meta asset-desc dim" :title="matDesc(m)">{{ matDesc(m) || '场景描述待补充' }}</div>
                  <div v-if="m.lighting" class="asset-meta asset-light dim" :title="m.lighting">光照 · {{ m.lighting }}</div>
                </template>
                <template v-else>
                  <div class="prop-name-row">
                    <span class="asset-name" :title="m.name">{{ m.name }}</span>
                    <span class="tag">{{ m.type || '道具' }}</span>
                  </div>
                  <div class="asset-meta asset-desc dim" :title="m.description || ''">{{ m.description || '暂无描述' }}</div>
                </template>
                <div class="asset-meta asset-final" :class="{ dim: !m.finalPrompt }" :title="m.finalPrompt || ''">
                  <span class="afp-label">{{ g.kindKey === 'scene' ? '最终提示词 · 固定视角' : '最终提示词 · 白底单品' }}</span>
                  {{ m.finalPrompt || (g.kindKey === 'scene' ? '首次生成图片时由提示词 Agent 自动生成（前景/中景/后景）' : '首次生成图片时由提示词 Agent 自动生成（白底单品）') }}
                </div>
              </div>
              <div class="asset-foot">
                <span :class="['dot', matHasImage(m) && 'ok', isPending(m) && 'pending']" />
                <button class="btn btn-sm ml-auto" type="button" title="上传图片" :disabled="isUploading(m)" @click.stop="uploadMaterial(m)">
                  <span v-if="isUploading(m)" class="ring-spinner sm"></span>
                  <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  上传
                </button>
                <button class="btn btn-sm" type="button" :disabled="isPending(m)" @click.stop="generateMaterial(m)">
                  <span v-if="isPending(m)" class="ring-spinner sm"></span>
                  {{ matHasImage(m) ? '重绘' : (isPending(m) ? '生成中' : '生成') }}
                </button>
              </div>
            </div>
          </div>
        </template>
      </template>

      <!-- 筛选某一类但该类暂无素材 -->
      <div v-if="assetTab !== 'all' && !visibleAssets.length" class="empty-state">
        <div class="empty-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
          </svg>
        </div>
        <p class="empty-title">暂无{{ tabLabel(assetTab) }}素材</p>
        <p class="empty-desc">在剧情工作台中提取并生成{{ tabLabel(assetTab) }}后，会显示在这里。</p>
      </div>
    </div>

    <!-- 素材详情 / 编辑对话框（与工作台资产卡片同款布局） -->
    <DetailAssetEditDialog :vm="vm" />

    <!-- 图片查看器 -->
    <div v-if="assetViewer.open" class="overlay viewer-overlay" @click.self="closeAssetViewer">
      <div class="dialog viewer-dialog">
        <div class="viewer-head">
          <span class="viewer-title">{{ assetViewer.title }}</span>
          <button class="btn btn-icon btn-sm btn-ghost" @click="closeAssetViewer">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <img :src="assetViewer.src" :alt="assetViewer.title" class="viewer-img" />
      </div>
    </div>
  </div>
</template>

<script setup>
import DetailAssetEditDialog from '~/views/drama/detail/panels/DetailAssetEditDialog.vue'

// vm = useDetailAssets(dramaId, drama, load) 的返回；解构为同名局部量以保模板绑定与拆分前逐字一致
const props = defineProps({ vm: { type: Object, required: true } })
const {
  assetTab, assetViewer, assetTabs, matHasImage, assetSrc, matDesc, tagClass, tabLabel,
  visibleAssets, assetTotal, assetGroups, materials, isPending, isUploading,
  generateMaterial, uploadMaterial, openAssetViewer, closeAssetViewer, fmtDate, openEdit,
} = props.vm
</script>

<style scoped src="~/assets/styles/drama.detail.css"></style>
