<!--
  Drama Mill — episode 工作台子组件（自 views/drama/episode.vue 机械拆分，模板与逻辑逐字保留）
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
              <aside class="storyboard-reference-panel" v-if="selectedSb">
                <div class="storyboard-ref-head">
                  <div>
                    <div class="storyboard-ref-title">参考素材</div>
                    <div class="storyboard-ref-copy">绑定角色 / 场景 / 道具作为视频参考</div>
                  </div>
                  <span class="tag mono">{{ refBindableAssets.filter(a => a.bound).length }}/{{ refBindableAssets.length }} 已绑定</span>
                </div>
                <div class="storyboard-ref-list">
                  <template v-for="group in ['角色', '场景', '道具']" :key="group">
                    <div v-if="refBindableAssets.filter(a => a.type === group).length" class="storyboard-ref-group">
                      <div class="storyboard-ref-group-label">{{ group }}</div>
                      <div
                        v-for="asset in refBindableAssets.filter(a => a.type === group)"
                        :key="asset.key"
                        :class="['storyboard-ref-item', { bound: asset.bound }]"
                        :title="asset.bound ? '点击移出参考' : '点击添加为参考'"
                        @click="toggleShotBind(selectedSb, asset)"
                      >
                        <button
                          type="button"
                          class="storyboard-ref-thumb"
                          :disabled="!asset.ready"
                          @click.stop="asset.ready && openImageViewer(assetImageSrc({ imageUrl: asset.imageUrl }), `${asset.name} ${asset.type}`)"
                        >
                          <img v-if="asset.ready" :src="thumbOf(assetImageSrc({ imageUrl: asset.imageUrl }))" class="previewable-image" loading="lazy" @error="thumbFallback($event, assetImageSrc({ imageUrl: asset.imageUrl }))" />
                          <span v-else>{{ asset.type === '场景' ? '景' : asset.type === '道具' ? '具' : '角' }}</span>
                        </button>
                        <div class="storyboard-ref-main">
                          <div class="storyboard-ref-line">
                            <span class="storyboard-ref-name">{{ asset.name }}</span>
                            <span :class="['storyboard-ref-state', asset.bound && asset.ready ? 'is-ready' : '']">
                              {{ asset.bound ? (asset.ready ? '可参考' : '未生成') : '未绑定' }}
                            </span>
                          </div>
                          <div class="storyboard-ref-meta">{{ asset.type }} · {{ asset.meta }}</div>
                          <button v-if="asset.bound && !asset.ready" type="button" class="storyboard-ref-goto" @click.stop="prodTab = 'assets'">去生成 →</button>
                        </div>
                      </div>
                    </div>
                  </template>
                  <div v-if="!refBindableAssets.length" class="storyboard-ref-empty">
                    当前集还没有场景、角色或道具，先到「资产」提取素材后即可绑定。
                  </div>
                </div>
              </aside>
</template>

<script setup>
import { EPISODE_WB } from '~/composables/episode/workbench-context'

const wb = inject(EPISODE_WB)
const {
  panel, selectedSb, refBindableAssets, toggleShotBind, openImageViewer,
  assetImageSrc, prodTab,
} = wb
</script>

<style scoped src="~/assets/styles/episode/episode.base.css"></style>
<style scoped src="~/assets/styles/episode/storyboard.css"></style>
