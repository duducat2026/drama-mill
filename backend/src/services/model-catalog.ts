/**
 * Drama Mill — AI 短剧生成平台
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
/**
 * 模型目录价服务门面 — 汇总只读检索侧与目录价派生刊例侧能力，
 * 保持既有 `services/model-catalog.js` 导入不变。
 * 分层：model-catalog-query.ts（价格列表检索/批量删除）· model-catalog-price.ts（目录价聚合派生计价口径，目录价即刊例价）
 */
export * from './model-catalog-query.js'
export * from './model-catalog-price.js'
