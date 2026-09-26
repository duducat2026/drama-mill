/**
 * 历史媒体只读盘点：不导入应用数据库模块，不搬迁或删除媒体，不修改数据库。
 * 项目根目录执行：node --import ./backend/node_modules/tsx/dist/loader.mjs backend/scripts/audit-storage-orphans.ts
 * 默认只检查本地 MySQL；报告写入 .qoder/spec/storage-audit.json，不包含凭据或字段原文。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql, { type RowDataPacket } from 'mysql2/promise'

const root = fileURLToPath(new URL('../../', import.meta.url))
const backendRoot = path.join(root, 'backend')
dotenv.config({ path: path.join(backendRoot, '.env'), quiet: true })
const storageRoot = path.join(root, 'data/static')
const reportPath = path.join(root, '.qoder/spec/storage-audit.json')
const tables = ['dramas', 'episodes', 'characters', 'scenes', 'props', 'storyboards', 'sys_task', 'assets', 'video_merges']
const PAGE = 500
const startedAt = new Date().toISOString()

type Reference = { table: string; id: number; column: string; status: string | null; softDeleted: boolean; match: string }
type Entry = {
  path: string; bytes: number; sha256: string; modifiedAt: string; formerPath: string | null
  references: Reference[]; decision: string; rollback: string
}

function relative(file: string) { return path.relative(root, file).split(path.sep).join('/') }

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) throw new Error('盘点目录包含符号链接，需人工核验')
    return entry.isDirectory() ? walk(full) : entry.isFile() ? [full] : []
  })
}

async function checksum(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

function connectionOptions() {
  const env = process.env
  const parsed = env.DATABASE_URL ? new URL(env.DATABASE_URL) : null
  const host = parsed?.hostname || env.MYSQL_HOST || '127.0.0.1'
  // 本次方案不扩展到远程服务器，连接目标不输出到报告。
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw new Error('REMOTE_DATABASE_REQUIRES_CONFIRMATION')
  return {
    host: host.replace(/^\[|\]$/g, ''),
    port: Number(parsed?.port || env.MYSQL_PORT || 3306),
    user: parsed ? decodeURIComponent(parsed.username) : env.MYSQL_USER || 'dramamill',
    password: parsed ? decodeURIComponent(parsed.password) : env.MYSQL_PASSWORD || 'dramamill_tool',
    database: parsed ? decodeURIComponent(parsed.pathname.slice(1)) : env.MYSQL_DATABASE || 'drama_mill',
    connectTimeout: 5000,
    charset: 'utf8mb4',
  }
}

function safeError(err: unknown): string {
  const error = err as { code?: string; message?: string }
  if (error.message === 'REMOTE_DATABASE_REQUIRES_CONFIRMATION') return error.message
  return /^[A-Z0-9_]+$/.test(error.code || '') ? error.code! : 'AUDIT_FAILED'
}

async function main() {
  const candidates = walk(path.join(storageRoot, '_orphan')).filter(file => /\.(mp4|jpg|png|webp)$/i.test(file))
  const loneThumbnail = path.join(storageRoot, 'uploads/f04f3106-453d-486b-b7a1-e06922012f6d_thumb.webp')
  if (fs.existsSync(loneThumbnail)) candidates.push(loneThumbnail)
  candidates.sort()
  const entries: Entry[] = []
  for (const file of candidates) {
    const before = fs.statSync(file)
    const sha256 = await checksum(file)
    const after = fs.statSync(file)
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('媒体在盘点期间变化，请在停止写入后重试')
    entries.push({
      path: relative(file), bytes: before.size, sha256, modifiedAt: before.mtime.toISOString(),
      formerPath: file.includes(`${path.sep}_orphan${path.sep}`) ? relative(file).replace('/_orphan/', '/') : null,
      references: [], decision: '保留：数据库核验未完成', rollback: '未搬迁，原位置保留',
    })
  }

  const byStem = new Map<string, Entry[]>()
  for (const entry of entries) {
    const stem = path.basename(entry.path).replace(/_thumb\.webp$|_poster\.jpg$|\.[^.]+$/g, '').toLowerCase()
    byStem.set(stem, [...(byStem.get(stem) || []), entry])
  }

  const scans: { table: string; columns: string[]; rows: number }[] = []
  const errors: string[] = []
  let verified = false
  let connection: mysql.Connection | undefined
  try {
    connection = await mysql.createConnection(connectionOptions())
    // 强制只读事务，不触发建表、种子或迁移；所有分页来自同一个一致性快照。
    await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await connection.query('SET SESSION TRANSACTION READ ONLY')
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT')
    const [metadata] = await connection.query<RowDataPacket[]>({
      sql: 'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)',
      timeout: 10000,
    }, [tables])
    for (const table of tables) {
      const columns = metadata.filter(row => row.TABLE_NAME === table)
      const names = columns.map(row => String(row.COLUMN_NAME))
      if (!names.includes('id')) throw new Error(`缺失必要表或主键：${table}`)
      const pathColumns = columns.filter(row => /char|text|json/.test(row.DATA_TYPE) && /url|path|image|thumbnail|params|metadata|scenes/.test(row.COLUMN_NAME))
        .map(row => String(row.COLUMN_NAME))
      if (!pathColumns.length) throw new Error(`缺失必要路径字段：${table}`)
      const projection = [...new Set(['id', ...pathColumns, ...['status', 'deleted_at'].filter(name => names.includes(name))])]
      // 所有标识符来自固定表白名单和服务端元数据，并经驱动转义。
      const selected = projection.map(name => mysql.escapeId(name)).join(', ')
      let lastId = 0
      let count = 0
      for (;;) {
        const [rows] = await connection.query<RowDataPacket[]>({
          sql: `SELECT ${selected} FROM ${mysql.escapeId(table)} WHERE id > ? ORDER BY id LIMIT ?`,
          timeout: 10000,
        }, [lastId, PAGE])
        if (!rows.length) break
        for (const row of rows) {
          for (const column of pathColumns) {
            let value = typeof row[column] === 'string' ? row[column] : JSON.stringify(row[column] ?? '')
            try { value = decodeURIComponent(value) } catch { /* 非 URL 字段保持原文 */ }
            // UUID 同时覆盖完整 URL、旧平铺/新分层路径及原文件派生图；宁可多保留，不漏掉关联资产。
            const stems = new Set(value.toLowerCase().match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g) || [])
            for (const stem of stems) {
              for (const entry of byStem.get(stem) || []) {
                entry.references.push({ table, id: Number(row.id), column, status: row.status ?? null,
                  softDeleted: Boolean(row.deleted_at), match: 'UUID 保守关联，包含原文件及派生图' })
              }
            }
          }
        }
        count += rows.length
        lastId = Number(rows.at(-1)!.id)
      }
      scans.push({ table, columns: pathColumns, rows: count })
    }
    verified = true
  } catch (err) {
    // 不记录连接串、认证错误原文或字段内容，防止报告泄露秘密。
    errors.push(safeError(err))
  } finally {
    if (connection) {
      await connection.rollback().catch(() => {})
      await connection.end()
    }
  }
  for (const entry of entries) {
    entry.decision = entry.references.length
      ? '保留：检测到数据库关联，需核验是否应恢复历史路径'
      : verified ? '保留待确认：快照未发现关联，尚未备份及开始隔离观察期' : '保留：数据库核验未完成'
  }

  const operationsFiles = ['.dbpass.tmp', '.rescue-historical.sh'].map(name => {
    const full = path.join(root, name)
    if (!fs.existsSync(full)) return { path: name, exists: false }
    const stat = fs.statSync(full)
    return { path: name, exists: true, mode: (stat.mode & 0o777).toString(8),
      decision: '保留：未确认外部依赖，不读取或报告秘密内容' }
  })
  const report = {
    startedAt, completedAt: new Date().toISOString(), databaseVerified: verified, errors,
    scope: '仅本工作区历史媒体及本地 MySQL；UUID 保守匹配，不是永久删除授权',
    mediaMutated: false, databaseMutated: false, backupCreated: false, isolationStarted: false,
    configuredStorageDiffers: path.resolve(backendRoot, process.env.STORAGE_PATH || '../data/static') !== storageRoot,
    categoryOverridesPresent: ['ASSET_PATH', 'VIDEO_PATH', 'MERGED_PATH', 'UPLOAD_PATH'].filter(key => Boolean(process.env[key])),
    counts: { total: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
      referenced: entries.filter(entry => entry.references.length).length,
      unreferencedInSnapshot: verified ? entries.filter(entry => !entry.references.length).length : null },
    scans, operationsFiles, entries,
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify({ report: relative(reportPath), databaseVerified: verified, counts: report.counts, errors }, null, 2))
  if (!verified) process.exitCode = 1
}

main().catch(err => { console.error(safeError(err)); process.exitCode = 1 })

