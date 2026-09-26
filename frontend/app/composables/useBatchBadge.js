// useBatchBadge — 项目启动台（index.vue）运行中批次徽标轮询逻辑，由超限文件拆分外提。
// 存在运行中/排队批次时低频轮询拉取入口按钮徽标计数；页签隐藏时不发请求，回前台恢复。
import { productionBatchAPI } from '~/composables/useApi'

export function useBatchBadge() {
  const runningBatches = ref([])
  // 运行中批次徽标：入口按钮上提示有多少批次正在生产 / 排队中
  const runningBatchBadge = computed(() => runningBatches.value.length || '')

  let batchTimer = null
  // 批次徽标拉取（请求完成后再排程，慢接口不叠加）
  async function fetchBatchBadge() {
    try {
      const list = await productionBatchAPI.list()
      runningBatches.value = (list || []).filter(b => b.status === 'running' || b.status === 'pending')
    } catch {}
  }
  async function loadBatches() {
    await fetchBatchBadge()
    scheduleBatchPoll()
  }
  // 批次徽标低频轮询：存在运行中/排队批次时 20s 拉一次，无批次则停（首查在 load 中触发）；页签隐藏时不发请求，回前台恢复
  function scheduleBatchPoll() {
    if (batchTimer) { clearTimeout(batchTimer); batchTimer = null }
    if (!runningBatches.value.length) return
    batchTimer = setTimeout(async () => {
      if (typeof document !== 'undefined' && document.hidden) { scheduleBatchPoll(); return }
      await fetchBatchBadge()
      scheduleBatchPoll()
    }, 20000)
  }
  onBeforeUnmount(() => { if (batchTimer) clearTimeout(batchTimer) })

  return { runningBatches, runningBatchBadge, loadBatches }
}
