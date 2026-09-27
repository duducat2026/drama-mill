/*
 * Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
 * Copyright (C) 2026 Drama Mill <52859273@qq.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * 客户端认证恢复插件
 *
 * SSR 模式下 useState 初始化在服务端运行，localStorage 不可用导致 token 被置为 null
 * 并序列化到客户端。客户端 hydrate 时直接使用服务端的 null 值，不会重新调用初始化函数。
 *
 * 本插件在客户端 hydrate 后、页面 onMounted 前从 localStorage 恢复 token，
 * 确保 fetchMe() 能读到 token 并完成自动登录。
 */
const TOKEN_KEY = 'drama_mill_token'

export default defineNuxtPlugin(() => {
  const token = useState<string | null>('auth_token')
  if (!token.value) {
    try {
      const stored = localStorage.getItem(TOKEN_KEY)
      if (stored) token.value = stored
    } catch {}
  }
})
