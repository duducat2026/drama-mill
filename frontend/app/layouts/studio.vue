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

<!-- 工作台全屏布局：不带全局顶栏，页面自行组织内部导航 -->
<template>
  <div class="studio-shell">
    <slot />
  </div>
</template>

<style scoped>
.studio-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-base);
}
</style>
