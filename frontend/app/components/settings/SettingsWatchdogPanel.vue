<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
  Copyright (C) 2026 Drama Mill <52859273@qq.com>
  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->

<template>
  <div>
    <div class="settings-head">
      <h2 class="settings-title">后台看门狗</h2>
      <p class="settings-desc">两项常驻巡检会在没有提交入口的情况下替你发起模型调用并按用量计价，因此默认都不启动；开启后可随时关闭，关闭只影响后续巡检轮次。</p>
    </div>
    <section class="card watchdog-panel" :class="{ 'is-on': watchdogOnCount > 0 }">
      <div class="watchdog-head">
        <div class="ai-call-icon">
          <TimerReset :size="16" :stroke-width="1.8" />
        </div>
        <div class="watchdog-head-body">
          <div class="watchdog-head-title">自动提交授权</div>
          <div class="watchdog-head-desc">{{ watchdogSummary }}</div>
        </div>
        <span :class="['tag', watchdogOnCount ? 'tag-success' : 'tag-warning']">{{ watchdogOnCount ? `已开启 ${watchdogOnCount} / 2` : '全部不启动' }}</span>
      </div>
      <div v-for="wd in watchdogItems" :key="wd.kind" class="watchdog-row" :class="{ 'is-on': watchdogs[wd.kind] }">
        <div class="watchdog-row-body">
          <div class="watchdog-row-title">{{ wd.label }}</div>
          <div class="watchdog-row-desc">{{ wd.desc }}</div>
        </div>
        <span :class="['tag', watchdogs[wd.kind] ? 'tag-success' : 'tag-warning']">{{ watchdogs[wd.kind] ? '已开启' : '不启动' }}</span>
        <label class="config-switch" :title="wd.tip">
          <input
            type="checkbox"
            class="sr-only"
            role="switch"
            :aria-label="wd.label"
            :checked="watchdogs[wd.kind]"
            :disabled="watchdogSubmitting === wd.kind"
            @change="onWatchdogToggle(wd.kind, $event)"
          >
          <span class="switch" :class="{ on: watchdogs[wd.kind] }"></span>
        </label>
      </div>
      <p v-if="!aiCallEnabled" class="watchdog-note">模型调用总开关已关闭：即使开启看门狗，后台也不会提交任何调用。</p>
      <p v-else-if="!watchdogOnCount" class="watchdog-note">两项巡检均已停止：失败任务与缺图资产只保留手动入口，不会在后台自动重试。</p>
    </section>
    <section class="card setup-panel">
      <div class="setup-panel-head compact">
        <div>
          <div class="setup-title">生效边界</div>
          <div class="setup-desc">开关只拦「自动提交模型调用」这一步，不是巡检总控。</div>
        </div>
      </div>
      <ul class="watchdog-rules">
        <li>卡死任务判失败、状态同步等不碰模型的清理始终执行，避免失败任务与孤儿任务堆积。</li>
        <li>与「AI 服务 → 模型调用总开关」是「与」关系：总开关关闭时后台一律不提交调用。</li>
        <li>设置页「生成测试」发起的任务永不自动重提，人工重试同样拒绝，避免一次测试被重复计费。</li>
        <li>自动重提受单任务次数上限、失败时间窗口与每轮限量约束，阈值由管理端配置。</li>
      </ul>
    </section>
  </div>
</template>

<script setup>
import { TimerReset } from 'lucide-vue-next'

const {
  aiCallEnabled, watchdogs, watchdogItems, watchdogSubmitting,
  watchdogOnCount, watchdogSummary, onWatchdogToggle,
} = inject('settings-ctx')
</script>

<style scoped src="~/assets/styles/settings.css"></style>
