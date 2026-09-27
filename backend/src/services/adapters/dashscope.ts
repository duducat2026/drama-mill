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
 * 阿里云百炼 DashScope 图片 / 视频生成 Adapter 门面。
 * 具体实现按职责拆分到 dashscope-image.ts / dashscope-video.ts；
 * 公共请求头/尺寸/状态映射放在 dashscope-shared.ts。
 */
export { DashScopeImageAdapter } from './dashscope-image'
export { DashScopeVideoAdapter } from './dashscope-video'
export {
  ASYNC_HEADER,
  asyncHeaders,
  isHappyHorseVideoModel,
  isStreamOnlyModel,
  isWan3VideoModel,
  stripModelSymbol,
  syncHeaders,
  toDashScopeSize,
  toWan3Ratio,
} from './dashscope-shared'
