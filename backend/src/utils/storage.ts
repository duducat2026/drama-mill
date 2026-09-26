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
 * 文件存储工具门面 — 汇总核心路径/写入/图片处理三块能力，保持既有 `utils/storage.js` 导入不变。
 * 分层：storage-core.ts（分类根/路径/生命周期/类型映射）· storage-write.ts（下载/上传/Base64）·
 *       storage-image.ts（缩略图/dataURL/远程压缩）
 */
export * from './storage-core.js'
export * from './storage-write.js'
export * from './storage-image.js'
