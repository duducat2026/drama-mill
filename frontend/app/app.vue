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

<!-- 应用根壳：布局包裹页面 + 顶部路由进度条 + 全局 toast 容器 -->
<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>

  <!-- 路由切换进度条：挂在根层，任何布局内页面导航都有反馈 -->
  <NuxtLoadingIndicator :height="2" :duration="3000" color="#3b82f6" />

  <!-- vue-sonner：右上角出栈，3 秒自动消失 -->
  <Toaster :duration="3000" position="top-right" />
</template>

<script setup>
import { Toaster } from 'vue-sonner'
</script>

<style>
@import '~/assets/studio.css';
</style>
