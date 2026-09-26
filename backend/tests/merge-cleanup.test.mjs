import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

// 直接执行源码中的函数，隔离数据库启动迁移与真实素材目录。
function loadFunction(file, name, globals) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(declaration, `缺少函数 ${name}`)
  const code = declaration.getText(source).replace(/^export\s+/, '')
  const { outputText } = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
  return vm.runInNewContext(`${outputText}\n${name}`, globals)
}

function mergeHarness(overrides = {}) {
  const files = new Map()
  const removed = []
  const warnings = []
  const updates = []
  let id = 0
  const globals = {
    path,
    fs: {
      mkdirSync() {},
      writeFileSync(file, content) { files.set(file, content) },
      unlinkSync(file) { removed.push(file); files.delete(file) },
    },
    uuid: () => `task-${++id}`,
    getStorageRoot: () => '/storage',
    toAbsPath: file => `/storage/${file}`,
    buildAssetDir: () => '/storage/merged/2/3',
    tenantNestedPath: () => '2/3',
    canStreamCopy: async () => true,
    pickVideoEncoder: () => ['-c:v', 'libx264'],
    runFfmpeg: async () => {},
    getVideoDuration: async () => 10,
    extractVideoPoster: async () => {},
    now: () => 'test-time',
    logTaskWarn: (...args) => warnings.push(args),
    logTaskSuccess() {},
    eq: (a, b) => [a, b],
    schema: { videoMerges: { id: 'merge' }, episodes: { id: 'episode' } },
    db: { update: table => ({ set: values => ({ where: async () => updates.push({ table, values }) }) }) },
  }
  Object.assign(globals, overrides)
  const merge = loadFunction('../src/services/ffmpeg-merge.ts', 'doMerge', globals)
  return { merge, globals, files, removed, warnings, updates }
}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const tick = () => new Promise(resolve => setImmediate(resolve))

test('合成成功：只清理本任务清单，保留视频并完成数据库回填', async () => {
  const h = mergeHarness()
  h.files.set('/storage/videos/source.mp4', '视频')
  await h.merge(1, 2, 3, 2, ['videos/source.mp4'])
  assert.deepEqual(h.removed, ['/storage/temp/task-1.txt'])
  assert.equal(h.files.get('/storage/videos/source.mp4'), '视频')
  assert.equal(h.updates.length, 2)
})

test('合成失败：回收清单并保留原始异常，不写入完成状态', async () => {
  const failure = new Error('编码失败')
  const h = mergeHarness({ runFfmpeg: async () => { throw failure } })
  await assert.rejects(h.merge(1, 2, 3, 2, ['clip.mp4']), err => err === failure)
  assert.equal(h.files.size, 0)
  assert.equal(h.updates.length, 0)
})

test('清单写入部分失败：仍回收本次清单', async () => {
  const h = mergeHarness()
  const failure = new Error('磁盘写入失败')
  h.globals.fs.writeFileSync = file => { h.files.set(file, '部分内容'); throw failure }
  await assert.rejects(h.merge(1, 2, 3, 2, ['clip.mp4']), err => err === failure)
  assert.equal(h.files.size, 0)
  assert.equal(h.removed.length, 1)
})

test('清单已不存在时静默容错，不使成功合成失败', async () => {
  const h = mergeHarness()
  h.globals.fs.unlinkSync = () => { throw Object.assign(new Error('不存在'), { code: 'ENOENT' }) }
  await h.merge(1, 2, 3, 2, ['clip.mp4'])
  assert.equal(h.warnings.filter(args => args[1] === 'cleanup-list').length, 0)
  assert.equal(h.updates.length, 2)
})

test('回收权限异常仅告警，不掩盖原始合成失败', async () => {
  const failure = new Error('上游合成失败')
  const h = mergeHarness({ runFfmpeg: async () => { throw failure } })
  h.globals.fs.unlinkSync = () => { throw Object.assign(new Error('无权限'), { code: 'EACCES' }) }
  await assert.rejects(h.merge(1, 2, 3, 2, ['clip.mp4']), err => err === failure)
  assert.equal(h.warnings.filter(args => args[1] === 'cleanup-list').length, 1)
})

test('回收失败不阻断已成功视频的完成回填', async () => {
  const h = mergeHarness()
  h.globals.fs.unlinkSync = () => { throw Object.assign(new Error('文件占用'), { code: 'EBUSY' }) }
  await h.merge(1, 2, 3, 2, ['clip.mp4'])
  assert.equal(h.updates.length, 2)
  assert.equal(h.warnings.filter(args => args[1] === 'cleanup-list').length, 1)
})

test('并发合成：一个任务失败不会回收另一个活动任务的清单', async () => {
  const first = deferred()
  const second = deferred()
  let n = 0
  const h = mergeHarness({ runFfmpeg: () => (++n === 1 ? first.promise : second.promise) })
  const p1 = h.merge(1, 2, 3, 2, ['a.mp4'])
  const p2 = h.merge(2, 2, 3, 2, ['b.mp4'])
  await tick()
  assert.equal(h.files.size, 2)
  const failed = assert.rejects(p1, /任务一失败/)
  first.reject(new Error('任务一失败'))
  await failed
  assert.equal(h.files.size, 1)
  assert.ok(h.files.has('/storage/temp/task-3.txt'))
  second.resolve()
  await p2
  assert.equal(h.files.size, 0)
})

function ffmpegHarness(spawnOverride) {
  const child = new EventEmitter()
  child.stderr = new EventEmitter()
  const signals = []
  child.kill = signal => { signals.push(signal); return true }
  let timeout
  let cleared = false
  const run = loadFunction('../src/utils/ffmpeg.ts', 'runFfmpeg', {
    ffmpegPath: '/mock/ffmpeg',
    spawn: spawnOverride || (() => child),
    setTimeout: fn => { timeout = fn; return 1 },
    clearTimeout: () => { cleared = true },
  })
  return { child, signals, run, expire: () => timeout(), cleared: () => cleared }
}

test('FFmpeg 超时：发出 SIGKILL 后等待 close，再向调用方报告超时', async () => {
  const h = ffmpegHarness()
  let settled = false
  const result = h.run([], 1000)
  const rejected = assert.rejects(result, /执行超时 \(1s\)/)
  result.then(() => { settled = true }, () => { settled = true })
  h.expire()
  await tick()
  assert.deepEqual(h.signals, ['SIGKILL'])
  assert.equal(settled, false)
  h.child.emit('close', null)
  await rejected
  assert.equal(h.cleared(), true)
})

test('合成超时：进程关闭前清单仍存在，关闭后清单回收', async () => {
  const process = ffmpegHarness()
  const h = mergeHarness({ runFfmpeg: process.run })
  const result = h.merge(1, 2, 3, 2, ['clip.mp4'])
  const rejected = assert.rejects(result, /执行超时/)
  await tick()
  process.expire()
  await tick()
  assert.equal(h.files.size, 1)
  process.child.emit('close', null)
  await rejected
  assert.equal(h.files.size, 0)
  assert.equal(h.updates.length, 0)
})

test('FFmpeg 启动错误：close 后保留原错误且释放定时器', async () => {
  const h = ffmpegHarness()
  const failure = new Error('ENOENT')
  const rejected = assert.rejects(h.run([]), err => err === failure)
  h.child.emit('error', failure)
  h.child.emit('close', -2)
  await rejected
  assert.equal(h.cleared(), true)
})

test('FFmpeg 同步启动异常：可被调用方捕获', async () => {
  const failure = new Error('EFTYPE')
  const h = ffmpegHarness(() => { throw failure })
  await assert.rejects(h.run([]), err => err === failure)
})

test('FFmpeg 正常退出与非零退出：结果及错误摘要保持兼容', async () => {
  const ok = ffmpegHarness()
  const result = ok.run([])
  ok.child.emit('close', 0)
  await result
  assert.equal(ok.cleared(), true)

  const bad = ffmpegHarness()
  const rejected = assert.rejects(bad.run([]), /ffmpeg exit 1: 编码错误/)
  bad.child.stderr.emit('data', Buffer.from('编码错误'))
  bad.child.emit('close', 1)
  await rejected
})
