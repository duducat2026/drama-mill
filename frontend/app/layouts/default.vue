<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
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
  用户侧全局布局：毛玻璃顶栏（品牌/主导航/账号区）+ 条件横幅 + 内容槽
  跨页面复用，页面级数据不进布局；AI 配置缺失与总开关关闭各占一条横幅
-->
<template>
  <div class="shell">
    <header class="header">
      <div class="header-left">
        <button class="brand" @click="navigateTo('/')">
          <div class="brand-mark">
            <img v-if="showBrandImage" :src="brandLogo" alt="短剧工坊" class="brand-logo" @error="showBrandImage = false" />
            <span v-else class="brand-fallback">剧</span>
          </div>
          <div class="brand-text">
            <span class="brand-name">短剧工坊</span>
            <span class="brand-sub">Drama Mill</span>
          </div>
        </button>
      </div>

      <!-- 主导航做成分段控件样式：药丸轨道 + 白底凸起当前项 -->
      <nav class="header-nav">
        <NuxtLink to="/" class="nav-link" :class="{ active: route.path === '/' }">
          <LayoutGrid :size="15" :stroke-width="1.8" />
          <span>项目</span>
        </NuxtLink>
        <NuxtLink to="/novels" class="nav-link" :class="{ active: route.path.startsWith('/novels') }">
          <BookOpen :size="15" :stroke-width="1.8" />
          <span>文档库</span>
        </NuxtLink>
        <NuxtLink to="/cloud-queue" class="nav-link" :class="{ active: route.path === '/cloud-queue' }">
          <ListOrdered :size="15" :stroke-width="1.8" />
          <span>云端队列</span>
        </NuxtLink>
        <NuxtLink to="/settings" class="nav-link" :class="{ active: route.path === '/settings' || route.path.startsWith('/settings/') }">
          <Settings :size="15" :stroke-width="1.8" />
          <span>设置</span>
        </NuxtLink>
      </nav>

      <!-- 账号区固定在顶栏最右：改密/登出在任意用户页一步可达 -->
      <div class="header-right">
        <UserMenu />
      </div>
    </header>

    <!-- 缺任一服务类型的活跃配置就挂引导横幅；总开关关闭时让位给开关横幅，避免同色双横幅叠排 -->
    <div v-if="missingConfigLabels.length && aiCallEnabled" class="config-banner">
      <TriangleAlert :size="14" :stroke-width="1.8" />
      <span>尚未配置{{ missingConfigLabels.join('、') }}模型,AI 功能无法使用</span>
      <NuxtLink to="/settings" class="config-banner-link">前往设置</NuxtLink>
    </div>

    <!-- 模型调用总开关关闭：全站显式提示，防止用户在不知情状态下反复触发生成 -->
    <div v-if="!aiCallEnabled" class="config-banner is-ai-off">
      <PowerOff :size="14" :stroke-width="1.8" />
      <span>{{ AI_CALL_OFF_TIP }}</span>
      <button type="button" class="config-banner-link" :disabled="aiCallSubmitting" @click="onAiCallToggle(true)">立即打开</button>
    </div>

    <main class="content">
      <slot />
    </main>
  </div>
</template>

<script setup>
import { BookOpen, LayoutGrid, ListOrdered, PowerOff, Settings, TriangleAlert } from 'lucide-vue-next'
import { aiConfigAPI } from '~/composables/useApi'
import { AI_CALL_OFF_TIP, useAiSwitch } from '~/composables/useAiSwitch'
import brandLogo from '~/assets/drama-mill-logo-128.png'

const route = useRoute()
const showBrandImage = ref(true)

// 模型调用总开关：与设置页/工作台共享单例状态
const { aiCallEnabled, aiCallSubmitting, refreshAiCall, toggleAiCall } = useAiSwitch()
async function onAiCallToggle(next) {
  try { await toggleAiCall(next) } catch { /* toast 由具体页面处理，布局只负责展示 */ }
}

// 三类服务都要有启用配置；缺哪类报哪类中文名
const SERVICE_TYPE_LABELS = { text: '文本', image: '图片', video: '视频' }
const missingConfigLabels = ref([])

async function checkAiConfigs() {
  try {
    const configs = await aiConfigAPI.list()
    missingConfigLabels.value = Object.entries(SERVICE_TYPE_LABELS)
      .filter(([type]) => !configs.some(c => c.service_type === type && c.is_active))
      .map(([, label]) => label)
  } catch { /* 配置检查失败不阻塞页面 */ }
}

onMounted(() => { checkAiConfigs(); refreshAiCall() })
// 布局跨页面复用、onMounted 只跑一次：路由切换时补一次检查，覆盖设置页保存后返回的场景
watch(() => route.path, () => { checkAiConfigs(); refreshAiCall() })
</script>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-base);
}

/* —— 顶栏：半透明毛玻璃条 —— */
.header {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 32px;
  height: 60px;
  flex-shrink: 0;
  padding: 0 24px;
  background: rgba(251,251,253,0.72);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid var(--border);
}
.header-left { display: flex; align-items: center; }

.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 4px 8px 4px 4px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.18s var(--ease-out);
}
.brand:hover { background: var(--bg-hover); }
.brand:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px var(--button-focus);
}
.brand-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  overflow: hidden;
  background: var(--text-0);
  border-radius: 9px;
}
.brand-logo {
  display: block;
  width: 22px;
  height: 22px;
  object-fit: contain;
}
.brand-fallback {
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
  color: #fff;
}
.brand-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.15;
}
.brand-name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-0);
}
.brand-sub {
  margin-top: 1px;
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: var(--text-3);
}

/* —— 主导航：分段控件轨道 —— */
.header-nav {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius-pill);
  background: rgba(0,0,0,0.05);
}
.nav-link {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 16px;
  border: none;
  border-radius: var(--radius-pill);
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  color: var(--text-2);
  text-decoration: none;
  transition: all 0.18s var(--ease-out);
}
.nav-link:hover { color: var(--text-0); }
.nav-link.active {
  background: #fff;
  color: var(--text-0);
  box-shadow: 0 1px 4px rgba(0,0,0,0.1);
}
.nav-link:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px var(--button-focus);
}

/* —— 账号区：永远贴最右 —— */
.header-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

/* —— 警示横幅（缺配置 / 开关关闭共用版式）—— */
.config-banner {
  position: relative;
  z-index: 9;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 8px 24px;
  font-size: 12.5px;
  color: #92400e;
  background: #fffbeb;
  border-bottom: 1px solid #fde68a;
}
.config-banner-link {
  margin-left: auto;
  padding: 2px 10px;
  border: 1px solid #fcd34d;
  border-radius: var(--radius-pill);
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.6;
  color: #b45309;
  text-decoration: none;
  transition: all 0.18s var(--ease-out);
}
.config-banner-link:hover { background: #fef3c7; color: #92400e; }
/* 开关横幅的「立即打开」是 button：补齐光标与字体继承，提交中降透明度 */
.is-ai-off .config-banner-link { cursor: pointer; font: inherit; line-height: 1.6; }
.is-ai-off .config-banner-link:disabled { opacity: 0.6; cursor: default; }

/* —— 内容槽 —— */
.content {
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}
</style>
