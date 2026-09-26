/*
 * Drama Mill — 云端异步任务查询：DashScope 批量任务列表拉取与计数
 *
 * 注意：该列表接口只支持中央域名 dashscope.aliyuncs.com，
 * workspace 专属域名（*.maas.aliyuncs.com）调用返回 404。
 */

export interface CloudTaskItem {
  task_id: string
  status: string
  model_name: string
  gmt_create: number
  start_time: number | null
  end_time: number | null
  api_key_id: string | null
}

export interface CloudTasksResult {
  total: number
  items: CloudTaskItem[]
  truncated: boolean
  error: string | null
}

/** 批量查询上限：PENDING 积压可能很大，只拉前 MAX 条避免打满 20 QPS 限流 */
const CLOUD_TASK_FETCH_CAP = 300
const CLOUD_TASK_PAGE_SIZE = 100

/** 查询指定模型 + 状态的云端任务列表（分页拉取直至取完或达上限） */
async function fetchCloudTasks(
  apiKey: string,
  model: string,
  status: 'PENDING' | 'RUNNING',
): Promise<CloudTasksResult> {
  const items: CloudTaskItem[] = []
  let total = 0
  try {
    for (let pageNo = 1; items.length < CLOUD_TASK_FETCH_CAP; pageNo++) {
      const url = `https://dashscope.aliyuncs.com/api/v1/tasks`
        + `?model_name=${encodeURIComponent(model)}&status=${status}`
        + `&page_no=${pageNo}&page_size=${CLOUD_TASK_PAGE_SIZE}`
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(20_000),
      })
      if (!resp.ok) return { total: 0, items, truncated: false, error: `上游返回 ${resp.status}` }
      const body: any = await resp.json()
      if (body.code) return { total: 0, items, truncated: false, error: `${body.code}: ${body.message || '查询失败'}` }
      total = Number(body.total) || 0
      const data = Array.isArray(body.data) ? body.data : []
      for (const t of data) {
        if (!t?.task_id) continue
        items.push({
          task_id: String(t.task_id),
          status: String(t.status || status),
          model_name: String(t.model_name || model),
          gmt_create: Number(t.gmt_create) || 0,
          start_time: t.start_time ? Number(t.start_time) : null,
          end_time: t.end_time ? Number(t.end_time) : null,
          api_key_id: t.api_key_id != null ? String(t.api_key_id) : null,
        })
      }
      // 最后一页：返回条数不足一页说明取完了
      if (data.length < CLOUD_TASK_PAGE_SIZE) break
    }
    return { total, items, truncated: total > items.length, error: null }
  } catch (err: any) {
    return { total: 0, items, truncated: false, error: err?.message || '查询异常' }
  }
}

/** 一次查询 PENDING + RUNNING 两组，合并为云端在途任务集合 */
export async function fetchCloudVideoTasks(apiKey: string, model: string): Promise<{
  pending: CloudTasksResult
  running: CloudTasksResult
  byTaskId: Map<string, CloudTaskItem>
}> {
  const [pending, running] = await Promise.all([
    fetchCloudTasks(apiKey, model, 'PENDING'),
    fetchCloudTasks(apiKey, model, 'RUNNING'),
  ])
  const byTaskId = new Map<string, CloudTaskItem>()
  for (const t of [...pending.items, ...running.items]) byTaskId.set(t.task_id, t)
  return { pending, running, byTaskId }
}

/** 单个模型池的在途计数（供页面多池明细展示） */
export interface CloudPoolStat {
  model: string
  pending_total: number
  running_total: number
  error: string | null
}

/**
 * 多池聚合查询：配置内每个模型各查一组 PENDING + RUNNING，合并为完整云端视图。
 * 背景：百炼每模型限流池相互独立（各 5 并发），多模型分流后真实负载摊到多个池，
 * 只查单池（models[0]）会严重低估在途总量；聚合才能看到全貌。
 * 单池查询失败不影响其他池（error 记录在 byModel 对应项），仅当全部失败才整体报错
 */
export async function fetchCloudVideoTasksMulti(apiKey: string, models: string[]): Promise<{
  pending: CloudTasksResult
  running: CloudTasksResult
  byTaskId: Map<string, CloudTaskItem>
  byModel: CloudPoolStat[]
}> {
  const results = await Promise.all(models.map(m => fetchCloudVideoTasks(apiKey, m)))
  const byTaskId = new Map<string, CloudTaskItem>()
  const byModel: CloudPoolStat[] = []
  const pendingItems: CloudTaskItem[] = []
  const runningItems: CloudTaskItem[] = []
  let pendingTotal = 0
  let runningTotal = 0
  let truncated = false
  const errors: string[] = []
  results.forEach((r, i) => {
    const err = r.pending.error || r.running.error
    if (err) errors.push(`${models[i]}: ${err}`)
    pendingTotal += r.pending.total
    runningTotal += r.running.total
    pendingItems.push(...r.pending.items)
    runningItems.push(...r.running.items)
    if (r.pending.truncated || r.running.truncated) truncated = true
    for (const t of r.byTaskId.values()) byTaskId.set(t.task_id, t)
    byModel.push({ model: models[i], pending_total: r.pending.total, running_total: r.running.total, error: err })
  })
  // 全部池失败才视为整体查询失败；部分失败时 by_model 明细里标注，其余池数据照常展示
  const allFailed = models.length > 0 && errors.length === models.length
  return {
    pending: { total: pendingTotal, items: pendingItems, truncated, error: allFailed ? errors.join('；') : null },
    running: { total: runningTotal, items: runningItems, truncated, error: null },
    byTaskId,
    byModel,
  }
}

/**
 * 上游队列水位轻量查询：只拉第一页取 total 字段（不分页拉全量），
 * 供水位限流闸门高频复查；查询失败返回 error，调用方据此放行（保守不阻塞）
 */
async function fetchCloudTaskTotal(apiKey: string, model: string, status: 'PENDING' | 'RUNNING'): Promise<{ count: number; error: string | null }> {
  try {
    const url = `https://dashscope.aliyuncs.com/api/v1/tasks`
      + `?model_name=${encodeURIComponent(model)}&status=${status}&page_no=1&page_size=1`
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!resp.ok) return { count: 0, error: `上游返回 ${resp.status}` }
    const body: any = await resp.json()
    if (body.code) return { count: 0, error: `${body.code}: ${body.message || '查询失败'}` }
    return { count: Number(body.total) || 0, error: null }
  } catch (err: any) {
    return { count: 0, error: err?.message || '查询异常' }
  }
}

export async function fetchCloudPendingCount(apiKey: string, model: string): Promise<{ count: number; error: string | null }> {
  return fetchCloudTaskTotal(apiKey, model, 'PENDING')
}

/**
 * 模型在途量（PENDING + RUNNING）：多模型分流选模时用，把任务分给上游压力小的模型池；
 * 任一状态查询失败即整体返回 error，调用方回退默认模型（不基于残缺数据分流）
 */
export async function fetchCloudInflightCount(apiKey: string, model: string): Promise<{ count: number; error: string | null }> {
  const [pending, running] = await Promise.all([
    fetchCloudTaskTotal(apiKey, model, 'PENDING'),
    fetchCloudTaskTotal(apiKey, model, 'RUNNING'),
  ])
  if (pending.error) return { count: 0, error: pending.error }
  if (running.error) return { count: 0, error: running.error }
  return { count: pending.count + running.count, error: null }
}
