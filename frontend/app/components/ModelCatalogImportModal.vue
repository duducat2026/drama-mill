<!--
  Drama Mill — 模型目录价：导入到平台刊例价弹窗（dry-run 预览 → 确认导入）
  从 admin/model-catalog.vue 抽离，聚焦导入流程；导入成功后 emit('imported') 由父页刷新概览。
-->
<template>
  <div v-if="open" class="mc-modal-mask" @click.self="$emit('close')">
    <div class="mc-modal">
      <div class="mc-modal-head">
        <span>导入目录价到平台刊例价</span>
        <button class="btn btn-ghost btn-sm btn-icon" @click="$emit('close')"><span>✕</span></button>
      </div>
      <div class="mc-modal-body">
        <p class="mc-hint">仅导入含价格的模型（视频/图片/token 三档），已存在的刊例价不覆盖；USD 按汇率折算为 CNY。</p>
        <label class="mc-field">
          <span>USD→CNY 汇率</span>
          <input v-model.number="usdRate" class="input" type="number" min="1" step="0.01" />
        </label>

        <div v-if="importBusy" class="mc-loading">正在解析目录价格并预览…</div>

        <div v-else-if="preview" class="mc-preview">
          <div class="mc-preview-grid">
            <div><b>{{ preview.planned }}</b> 条待导入</div>
            <div><b>{{ preview.by_type?.token || 0 }}</b> token</div>
            <div><b>{{ preview.by_type?.image || 0 }}</b> 图片</div>
            <div><b>{{ preview.by_type?.video_second || 0 }}</b> 视频/秒</div>
            <div class="mc-muted">跳过已存在 {{ preview.skipped_existing }} · 不支持 {{ preview.skipped_unsupported }}</div>
          </div>
          <div class="mc-sample-wrap">
            <table class="mc-sample">
              <thead><tr><th>模型</th><th>厂商</th><th>计费</th><th>输入</th><th>输出</th><th>单价</th></tr></thead>
              <tbody>
                <tr v-for="s in preview.sample" :key="s.model">
                  <td class="mono">{{ s.model }}</td>
                  <td>{{ s.provider }}</td>
                  <td>{{ typeLabel(s.billing_type) }}</td>
                  <td>{{ s.billing_type === 'token' ? s.input_price : '-' }}</td>
                  <td>{{ s.billing_type === 'token' ? s.output_price : '-' }}</td>
                  <td>{{ s.billing_type === 'token' ? '-' : s.unit_price }}</td>
                </tr>
              </tbody>
            </table>
            <div v-if="preview.planned > preview.sample.length" class="mc-muted mc-sample-more">仅展示前 {{ preview.sample.length }} 条…</div>
          </div>
        </div>

        <div v-if="importResult" class="mc-result">
          ✅ 导入完成：新增 <b>{{ importResult.inserted }}</b> 条（token {{ importResult.by_type?.token || 0 }} / 图片 {{ importResult.by_type?.image || 0 }} / 视频 {{ importResult.by_type?.video_second || 0 }}），跳过已存在 {{ importResult.skipped_existing }}。
        </div>
        <div v-if="importError" class="mc-result mc-result-err">⚠ {{ importError }}</div>
      </div>
      <div class="mc-modal-foot">
        <button class="btn btn-sm btn-ghost" :disabled="importBusy || !!importResult" @click="doPreview">重新预览</button>
        <button class="btn btn-sm" :disabled="importBusy || !preview || !!importResult" @click="doImport">
          {{ importBusy ? '处理中…' : `确认导入 ${preview ? preview.planned : 0} 条` }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { adminAPI } from '~/composables/useApi'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'imported'): void }>()

const importBusy = ref(false)
const usdRate = ref(7.2)
const preview = ref<any>(null)
const importResult = ref<any>(null)
const importError = ref('')

const TYPE_LABEL: Record<string, string> = { token: 'token', image: '图片', video_second: '视频/秒' }
function typeLabel(t: string) { return TYPE_LABEL[t] || t }

// 打开时重置上次结果并首次预览（预览结果缓存复用，重新预览按当前汇率刷新）
watch(() => props.open, (v) => {
  if (!v) return
  importResult.value = null
  importError.value = ''
  if (!preview.value) doPreview()
})

async function doPreview() {
  importBusy.value = true
  importError.value = ''
  importResult.value = null
  try {
    preview.value = await adminAPI.importModelCatalog({ usd_rate: usdRate.value, dry_run: true })
  } catch (e: any) {
    importError.value = e?.message || '预览失败'
    preview.value = null
  } finally {
    importBusy.value = false
  }
}

async function doImport() {
  importBusy.value = true
  importError.value = ''
  try {
    importResult.value = await adminAPI.importModelCatalog({ usd_rate: usdRate.value, dry_run: false })
    preview.value = null
    emit('imported')
  } catch (e: any) {
    importError.value = e?.message || '导入失败'
  } finally {
    importBusy.value = false
  }
}
</script>

<style scoped>
.mc-modal-mask {
  position: fixed; inset: 0; z-index: 60;
  background: rgba(0,0,0,0.35);
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.mc-modal {
  width: 640px; max-width: 100%; max-height: 88vh; overflow: auto;
  background: #fff; border: 1px solid var(--border); border-radius: 14px;
  display: flex; flex-direction: column;
}
.mc-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid var(--border);
  font-size: 14px; font-weight: 700; color: var(--text-0);
}
.mc-modal-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
.mc-modal-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--border); }

.mc-hint { font-size: 12px; color: var(--text-3); margin: 0; line-height: 1.5; }
.mc-field { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--text-1); }
.mc-field .input { width: 120px; }
.mc-loading { font-size: 12.5px; color: var(--text-3); padding: 10px 0; }
.mc-muted { color: var(--text-3); }

.mc-preview-grid {
  display: grid; grid-template-columns: repeat(5, auto); gap: 14px; align-items: baseline;
  font-size: 12.5px; color: var(--text-2);
}
.mc-preview-grid b { font-size: 17px; color: var(--text-0); margin-right: 2px; }

.mc-sample-wrap { border: 1px solid var(--border); border-radius: 10px; overflow: auto; max-height: 280px; }
.mc-sample { width: 100%; border-collapse: collapse; font-size: 12px; }
.mc-sample th { text-align: left; padding: 7px 10px; background: rgba(0,0,0,0.02); color: var(--text-3); font-weight: 600; white-space: nowrap; position: sticky; top: 0; }
.mc-sample td { padding: 6px 10px; border-top: 1px solid var(--border); color: var(--text-1); }
.mc-sample .mono { font-family: monospace; font-size: 11.5px; }
.mc-sample-more { padding: 8px 10px; font-size: 11.5px; }

.mc-result { font-size: 12.5px; color: var(--text-1); background: rgba(52,199,89,0.1); border-radius: 8px; padding: 10px 12px; }
.mc-result-err { color: var(--action-danger); background: rgba(255,59,48,0.08); }
</style>
