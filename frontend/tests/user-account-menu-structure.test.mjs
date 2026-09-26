// 用户侧「修改密码 + 常驻账号区」— 结构测试（源码断言，沿用现有约定）
// 用户名/退出登录必须出现在每个用户操作页：全站顶栏（default/studio 工作台）都挂 UserMenu
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { episodeViewSource } from './helpers/episode-sources.mjs'
import { readUseApiSources } from './helpers/use-api-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const useApi = readUseApiSources(root)
const useAuth = read('app/composables/useAuth.ts')
const userMenu = read('app/components/UserMenu.vue')
const pwdDialog = read('app/components/ChangePasswordDialog.vue')
const defaultLayout = read('app/layouts/default.vue')
const episodeView = episodeViewSource()
const launcherPage = read('app/pages/index.vue')
const launcherCss = read('app/assets/styles/launcher.css')

test('useApi / useAuth 接通改密端点', () => {
  assert.match(useApi, /export const accountAPI = \{/)
  assert.match(useApi, /api\.post<\{ changed: boolean \}>\('\/auth\/change-password', d\)/)
  assert.match(useAuth, /async function changePassword\(oldPassword: string, newPassword: string, confirmPassword: string\)/)
  assert.match(useAuth, /await accountAPI\.changePassword\(\{ oldPassword, newPassword, confirmPassword \}\)/)
  assert.match(useAuth, /return \{ token, user, isLoggedIn, isAdmin, login, fetchMe, logout, changePassword \}/)
})

test('UserMenu: 用户名常驻 + 修改密码/退出登录下拉', () => {
  assert.match(userMenu, /const \{ user, token, isAdmin, fetchMe, logout \} = useAuth\(\)/)
  // 刷新后 user 为空时按 token 补拉，保证任意页面顶栏都有用户名
  assert.match(userMenu, /if \(!user\.value && token\.value\) fetchMe\(\)/)
  assert.match(userMenu, /user\.value\?\.nickname \|\| user\.value\?\.username/)
  assert.match(userMenu, /<span>修改密码<\/span>/)
  assert.match(userMenu, /<span>退出登录<\/span>/)
  assert.match(userMenu, /<ChangePasswordDialog :open="showChangePassword" @close="showChangePassword = false" \/>/)
  // 点击外部与 Esc 收起，路由切换不残留面板
  assert.match(userMenu, /document\.addEventListener\('click', onDocumentClick\)/)
  assert.match(userMenu, /watch\(\(\) => route\.fullPath, close\)/)
})

test('ChangePasswordDialog: 三项必填 + 长度/一致性前端校验', () => {
  assert.match(pwdDialog, /原密码/)
  assert.match(pwdDialog, /确认新密码/)
  assert.match(pwdDialog, /if \(form\.newPassword\.length < MIN_PWD_LEN\)/)
  assert.match(pwdDialog, /两次输入的新密码不一致/)
  assert.match(pwdDialog, /新密码不能与原密码相同/)
  assert.match(pwdDialog, /await changePassword\(form\.oldPassword, form\.newPassword, form\.confirmPassword\)/)
  assert.match(pwdDialog, /toast\.success\('密码已修改'\)/)
  // 提交中禁止关闭，避免请求在途时对话框消失造成状态困惑
  assert.match(pwdDialog, /if \(submitting\.value\) return/)
})

test('账号区常驻：全站顶栏最右 + 工作台顶栏', () => {
  // default 布局：header 最右侧固定账号区
  assert.match(defaultLayout, /<div class="header-right">\s*<UserMenu \/>\s*<\/div>/)
  assert.match(defaultLayout, /\.header-right \{\s*margin-left: auto;/)
  // 工作台走 studio 布局（自带顶栏），页面内同样挂账号区
  assert.match(episodeView, /<UserMenu size="sm" \/>/)
  // 首页原地的用户名/退出登录已下线，避免与顶栏重复
  assert.doesNotMatch(launcherPage, /hero-user-logout|退出登录/)
  assert.doesNotMatch(launcherCss, /\.hero-user-logout/)
})
