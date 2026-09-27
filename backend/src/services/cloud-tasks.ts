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
 * 云端异步任务查询门面 — 汇总 DashScope 批量任务拉取/计数与查询目标解析/本地比对能力，
 * 保持既有 `services/cloud-tasks.js` 导入不变。
 * 分层：cloud-tasks-fetch.ts（列表拉取/计数）· cloud-tasks-compare.ts（目标解析/掩码/本地↔云端比对）
 */
export * from './cloud-tasks-fetch.js'
export * from './cloud-tasks-compare.js'
