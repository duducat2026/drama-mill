// 多租户分层存储布局 — 结构测试（源码断言，沿用现有约定）
// 生成产物必须落 `{分类}/{user_id}/{drama_id}/` 分层目录；迁移脚本须覆盖全部存路径列且幂等
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readGenerationSources } from './helpers/generation-sources.mjs'
import { readStorageSources } from './helpers/storage-sources.mjs'
import { readMigrateStorageSources } from './helpers/migrate-storage-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('storage：分层目录构建能力与嵌套路径落盘参数', () => {
  const src = readStorageSources(root)
  // 分类根嵌套解析必须经 categoryDir（保证 ASSET_PATH 等外挂卷环境变量生效）
  assert.match(src, /export function resolveCategoryPath\(category: string, nested = ''\): string/)
  assert.match(src, /return nested \? path\.join\(categoryDir\(category\), nested\) : categoryDir\(category\)/)
  // 租户嵌套段：{user_id}/{drama_id}，缺失回退 0 / unassigned
  assert.match(src, /export function tenantNestedPath/)
  assert.match(src, /`\$\{userId \?\? 0\}\/\$\{dramaId \?\? 'unassigned'\}`/)
  assert.match(src, /export function buildAssetDir/)
  // 三个写入函数均带可选嵌套段参数
  assert.match(src, /export async function downloadFile\(url: string, subDir: string, nestedPath = ''\)/)
  assert.match(src, /export async function saveUploadedFile\(data: ArrayBuffer, subDir: string, originalName: string, nestedPath = ''\)/)
  assert.match(src, /export async function saveBase64Image\(base64Data: string, mimeType: string, subDir: string, nestedPath = ''\)/)
  // 生命周期回收工具（供硬删/注销入口接入）
  assert.match(src, /export function removeDramaStorage/)
  assert.match(src, /export function removeUserStorage/)
})

test('generation：图片/视频落盘携带任务上的租户上下文（零额外查询）', () => {
  const src = readGenerationSources(root)
  assert.match(src, /downloadFile\(imageUrl, 'images', tenantNestedPath\(record\.userId, record\.dramaId\)\)/)
  assert.match(src, /saveBase64Image\(base64Data, mimeType, 'images', tenantNestedPath\(record\.userId, record\.dramaId\)\)/)
  assert.match(src, /downloadFile\(videoUrl, 'videos', tenantNestedPath\(record\.userId, record\.dramaId\)\)/)
  // 不允许残留平铺落盘（无嵌套段的调用）
  assert.doesNotMatch(src, /downloadFile\(imageUrl, 'images'\)\s*$/)
  assert.doesNotMatch(src, /downloadFile\(videoUrl, 'videos'\)\s*$/)
})

test('ffmpeg-merge：成片落 {merged}/{user_id}/{drama_id}/ 并透传租户上下文', () => {
  const src = read('src/services/ffmpeg-merge.ts')
  assert.match(src, /doMerge\(mergeId, episodeId, dramaId, userId \?\? null, videos\)/)
  assert.match(src, /buildAssetDir\('merged', userId, dramaId\)/)
  assert.match(src, /`static\/merged\/\$\{tenantNestedPath\(userId, dramaId\)\}\/\$\{outputFilename\}`/)
  // 不允许残留平铺成片路径
  assert.doesNotMatch(src, /categoryDir\('merged'\)/)
})

test('upload：上传素材按租户隔离落 uploads/{user_id}/', () => {
  const src = read('src/routes/upload.ts')
  assert.match(src, /function uploadNested/)
  assert.match(src, /saveUploadedFile\(buffer, 'uploads', file\.name, uploadNested\(c\)\)/)
  // 三处上传入口（图片/媒体/文档留档）都必须带租户段
  assert.equal((src.match(/uploadNested\(c\)/g) || []).length, 3)
})

test('migrate-storage-layout：迁移脚本覆盖全部存路径列且具备安全特性', () => {
  const src = readMigrateStorageSources(root)
  // 全表扫描防护：大表按 id 分段流式读取（keyset 分页）
  assert.match(src, /gt\(table\.id, lastId\)/)
  assert.match(src, /\.limit\(PAGE\)/)
  // 关键列覆盖：sys_task.local_path（generation-refs 本地回退依赖）/ video_merges.merged_url / assets 三列
  assert.match(src, /localPath: schema\.sysTask\.localPath/)
  assert.match(src, /mergedUrl: schema\.videoMerges\.mergedUrl/)
  assert.match(src, /thumbnailUrl: schema\.assets\.thumbnailUrl/)
  // storyboards 七个路径列
  assert.match(src, /composedImage: schema\.storyboards\.composedImage/)
  assert.match(src, /subtitleUrl: schema\.storyboards\.subtitleUrl/)
  // 安全特性：dry-run / 幂等判定 / 跨卷降级 / 孤儿归档
  assert.match(src, /--dry-run/)
  assert.match(src, /FLAT_RE/)
  assert.match(src, /EXDEV/)
  assert.match(src, /_orphan/)
  // 派生文件跟随搬迁：缩略图与海报帧
  assert.match(src, /thumbPathFor\(oldRel\)/)
  assert.match(src, /posterPathFor\(oldRel\)/)
  // DB 回写按主键定点更新并分批事务
  assert.match(src, /tx\.update\(table\)\.set\(u\.set\)\.where\(eq\(table\.id, u\.id\)\)/)
})
