// 登录页「密码显示/隐藏」— 结构测试（源码断言，沿用现有约定）
// 默认必须保持密文（type=password），切换只影响显示，不改变提交值与 autocomplete 语义
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const login = readFileSync(new URL('app/pages/login.vue', root), 'utf8')

test('登录页密码框支持明文/密文切换', () => {
  assert.match(login, /const showPassword = ref\(false\)/)
  assert.match(login, /import \{ Eye, EyeOff \} from 'lucide-vue-next'/)
  // 双向切换：text / password 由 showPassword 驱动，两个图标互斥渲染
  assert.match(login, /:type="showPassword \? 'text' : 'password'"/)
  assert.match(login, /<EyeOff v-if="showPassword"/)
  assert.match(login, /<Eye v-else/)
  assert.match(login, /@click="showPassword = !showPassword"/)
})

test('切换按钮不破坏登录表单语义', () => {
  // 默认密文：showPassword 初始为 false，且隐藏态 title 提示「显示密码」
  assert.match(login, /:title="showPassword \? '隐藏密码' : '显示密码'"/)
  assert.match(login, /:aria-label="showPassword \? '隐藏密码' : '显示密码'"/)
  // 按钮必须 type="button"，否则点击会触发表单 submit
  assert.match(login, /type="button" class="login-pwd-toggle"/)
  // 自动填充与提交值不变
  assert.match(login, /autocomplete="current-password"/)
  assert.match(login, /await login\(username\.value\.trim\(\), password\.value\)/)
  // 图标绝对定位在输入框内，右侧留出不被遮挡的内边距
  assert.match(login, /\.login-pwd \{ position: relative; \}/)
  assert.match(login, /\.login-pwd \.input \{ padding-right: 34px; \}/)
})

test('登录页提示首次部署默认账号（与后端 SEED_USERS 对齐）', () => {
  assert.match(login, /首次部署默认账号/)
  // 管理员 drama-mill / drama-mill；普通用户 test / drama-mill
  assert.match(login, /<code>drama-mill<\/code><span>\/<\/span><code>drama-mill<\/code>/)
  assert.match(login, /<code>test<\/code><span>\/<\/span><code>drama-mill<\/code>/)
  // 提示必须引导用户使用后立即改密
  assert.match(login, /修改密码/)
})
