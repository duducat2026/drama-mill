/**
 * 模型目录价服务门面 — 汇总只读检索侧与刊例价导入侧能力，
 * 保持既有 `services/model-catalog.js` 导入不变。
 * 分层：model-catalog-query.ts（连接池/清单/价格检索）· model-catalog-import.ts（聚合映射导入 model_prices）
 */
export * from './model-catalog-query.js'
export * from './model-catalog-import.js'
