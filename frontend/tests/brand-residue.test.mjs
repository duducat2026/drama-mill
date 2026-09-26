import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = file => readFileSync(path.join(root, file), 'utf8')

test('favicon 是新的 64×64 PNG，保持现有 URL 且不再使用旧火焰图标', () => {
  const image = readFileSync(path.join(root, 'frontend/public/favicon.png'))
  assert.equal(image.subarray(1, 4).toString(), 'PNG')
  assert.equal(image.readUInt32BE(16), 64)
  assert.equal(image.readUInt32BE(20), 64)
  const blobHash = createHash('sha1').update(`blob ${image.length}\0`).update(image).digest('hex')
  assert.notEqual(blobHash, '7109337342773367b81cea4b0022122e9e60b8ef')
  assert.match(read('frontend/nuxt.config.ts'), /href: '\/favicon\.png'/)
})

test('Nuxt 明确使用根 public 目录，避免 srcDir 调整后 favicon 不进入产物', () => {
  assert.match(read('frontend/nuxt.config.ts'), /public:\s*fileURLToPath\(new URL\('\.\/public\/', import\.meta\.url\)\)/)
})

test('页面保留当前品牌资源与高分辨率设计原稿', () => {
  assert.ok(existsSync(path.join(root, 'frontend/app/assets/drama-mill-logo.png')))
  assert.ok(existsSync(path.join(root, 'frontend/app/assets/drama-mill-logo-128.png')))
  for (const file of ['frontend/app/pages/login.vue', 'frontend/app/layouts/default.vue']) {
    assert.match(read(file), /assets\/drama-mill-logo-128\.png/)
  }
})
