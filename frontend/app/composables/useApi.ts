/*
 * Drama Mill — AI 短剧自动化生产平台 (https://github.com/your-org/drama-mill)
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
 * 前端 API 门面：按业务域拆分至 ~/api/* 各模块，此处统一再导出，
 * 保持全站既有的 `from '~/composables/useApi'` 导入路径与命名不变。
 */
export * from '~/api/core'
export * from '~/api/drama'
export * from '~/api/assets'
export * from '~/api/tasks'
export * from '~/api/novel'
export * from '~/api/production'
export * from '~/api/config'
export * from '~/api/admin'
export * from '~/api/auth'
