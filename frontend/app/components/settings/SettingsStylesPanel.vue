<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
  Copyright (C) 2026 Drama Mill <52859273@qq.com>
  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->

<template>
  <div class="settings-scroll">
    <div class="settings-head">
      <h2 class="settings-title">风格预设</h2>
      <p class="settings-desc">创建项目时选择的视觉风格，其英文提示词片段会自动注入角色图与场景图生成。内置风格全局共享（仅管理员可改），自建风格仅自己可见；停用的风格不出现在创建选项中。</p>
    </div>
    <section class="card svc-group">
      <div class="svc-group-head">
        <div class="svc-group-heading">
          <span class="svc-group-title">全部风格</span>
          <div class="svc-group-sub">{{ stylePresets.filter(p => p.is_active).length }} 个启用 · {{ stylePresets.length }} 个总计（含系统内置）</div>
        </div>
        <button class="btn btn-ghost btn-sm ml-auto" @click="startAddStyle"><Plus :size="13" /> 添加</button>
      </div>
      <div v-for="p in stylePresets" :key="p.id" class="config-row">
        <div class="provider-badge style-badge"><Palette :size="15" /></div>
        <div class="config-main">
          <div class="config-line">
            <span class="config-name">{{ p.name }}</span>
            <span class="tag mono">{{ p.value }}</span>
            <span v-if="p.is_system" class="tag">内置</span>
            <span v-if="!p.is_active" class="tag">已停用</span>
          </div>
          <div class="config-sub mono truncate">{{ p.prompt }}</div>
          <div v-if="p.description" class="config-sub truncate">{{ p.description }}</div>
        </div>
        <!-- 内置风格全局共享：非管理员只读，避免个人修改影响其他用户 -->
        <label v-if="!p.is_system || isAdmin" class="config-switch">
          <!-- sr-only 视觉隐藏但需可被读屏/自动化定位：aria-label 提供可访问名，role=switch 声明开关语义 -->
          <input
            type="checkbox" class="sr-only" role="switch"
            :checked="p.is_active"
            :aria-label="`${p.is_active ? '停用' : '启用'}风格「${p.name}」`"
            @change="toggleStyle(p)"
          >
          <span class="switch" :class="{ on: p.is_active }"></span>
        </label>
        <button v-if="!p.is_system || isAdmin" class="btn btn-ghost btn-icon btn-sm" @click="startEditStyle(p)"><Pencil :size="13" /></button>
        <button v-if="!p.is_system || isAdmin" class="btn btn-danger btn-icon btn-sm" @click="styleToDelete = p"><Trash2 :size="13" /></button>
      </div>
      <p v-if="!stylePresets.length" class="config-empty">暂无风格预设</p>
    </section>

    <!-- Style Preset Dialog -->
    <div v-if="styleDialog" class="overlay" @click.self="styleDialog = false">
      <form class="dialog config-dialog" @submit.prevent="saveStyle">
        <div class="dialog-head">
          <div>
            <div class="dialog-title">{{ styleEditId ? '编辑风格预设' : '添加风格预设' }}</div>
            <div class="dialog-sub">提示词片段为英文，会在生成角色图与场景图时自动拼入提示词。自建风格仅自己可见，不影响其他用户。</div>
          </div>
          <span class="tag tag-accent ml-auto"><Palette :size="12" /> 风格</span>
        </div>
        <div class="dialog-body config-dialog-body">
          <label class="field">
            <span class="field-label">风格名称 <span class="required">*</span></span>
            <input v-model="styleForm.name" class="input" placeholder="如 3D、动漫、写实电影" />
          </label>
          <label class="field">
            <span class="field-label">风格 key <span class="required">*</span></span>
            <input v-model="styleForm.value" class="input mono" placeholder="如 3d、anime（小写字母/数字/中划线）" :disabled="!!styleEditId" />
            <span class="field-hint">存入项目的风格标识，创建后不可修改。</span>
          </label>
          <label class="field">
            <span class="field-label">提示词片段（英文） <span class="required">*</span></span>
            <textarea v-model="styleForm.prompt" class="textarea" rows="3" placeholder="如 anime style, cel shading, vibrant colors, clean line art"></textarea>
          </label>
          <label class="field">
            <span class="field-label">描述</span>
            <input v-model="styleForm.description" class="input" placeholder="一句话说明该风格的适用场景" />
          </label>
          <label class="field">
            <span class="field-label">排序</span>
            <input v-model.number="styleForm.sort_order" class="input" type="number" min="0" max="999" />
          </label>
          <label v-if="isAdmin && !styleEditId" class="field">
            <span class="field-label">可见范围</span>
            <span class="field-hint"><input v-model="styleForm.is_system" type="checkbox" style="margin-right:6px" />设为系统内置（全局共享，所有用户创建项目时可选）</span>
          </label>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="styleDialog = false">取消</button>
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { Plus, Pencil, Trash2, Palette } from 'lucide-vue-next'

const {
  stylePresets, styleDialog, styleEditId, styleForm, styleToDelete,
  isAdmin, startAddStyle, startEditStyle, toggleStyle, saveStyle,
} = inject('settings-ctx')
</script>

<style scoped src="~/assets/styles/settings.css"></style>
