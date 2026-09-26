// 用户侧修改密码：POST /auth/change-password 结构测试（源码断言）
// 只允许改本人密码：原密码 bcrypt 校验 + 新密码长度/一致性 + 与旧密码不同 + 新哈希落库
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readUseApiSources } from '../../frontend/tests/helpers/use-api-sources.mjs'

const authRoute = readFileSync(new URL('../src/routes/auth.ts', import.meta.url), 'utf8')
const useApi = readUseApiSources(new URL('../../frontend/', import.meta.url))
const useAuth = readFileSync(new URL('../../frontend/app/composables/useAuth.ts', import.meta.url), 'utf8')
const pwdDialog = readFileSync(new URL('../../frontend/app/components/ChangePasswordDialog.vue', import.meta.url), 'utf8')

test('auth 路由：改密接口校验齐全并按 bcrypt 落新哈希', () => {
  assert.match(authRoute, /app\.post\('\/change-password', async \(c\) => \{/)
  // 目标用户只能取自鉴权注入的本人，不接受 body 传入 user_id
  assert.match(authRoute, /const me = c\.get\('user'\)/)
  assert.match(authRoute, /const row = await getUserById\(me\.id\)/)
  assert.match(authRoute, /if \(!row \|\| !verifyPassword\(oldPassword, row\.passwordHash\)\) return badRequest\(c, '原密码不正确'\)/)
  assert.match(authRoute, /newPassword\.length < MIN_PASSWORD_LEN/)
  assert.match(authRoute, /两次输入的新密码不一致/)
  assert.match(authRoute, /新密码不能与原密码相同/)
  assert.match(authRoute, /\.set\(\{ passwordHash: hashPassword\(newPassword\), updatedAt: now\(\) \}\)/)
  assert.match(authRoute, /\.where\(eq\(schema\.users\.id, me\.id\)\)/)
  // 原密码错误用 400 而非 401：401 会被前端当作登录态失效强制跳登录页
  assert.doesNotMatch(authRoute, /原密码不正确[\s\S]{0,40}401/)
})

test('前端接线：accountAPI → useAuth.changePassword → 改密弹窗', () => {
  assert.match(useApi, /api\.post<\{ changed: boolean \}>\('\/auth\/change-password', d\)/)
  assert.match(useAuth, /await accountAPI\.changePassword\(\{ oldPassword, newPassword, confirmPassword \}\)/)
  assert.match(pwdDialog, /await changePassword\(/)
})
