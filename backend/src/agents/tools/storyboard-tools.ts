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
 * 分镜拆解 Agent 工具门面：读工具 + 写工具按职责拆分到独立模块。
 */
import { readStoryboardContext } from './storyboard-tools-read.js'
import { saveStoryboards, updateStoryboard } from './storyboard-tools-write.js'

export { readStoryboardContext } from './storyboard-tools-read.js'
export { saveStoryboards, updateStoryboard } from './storyboard-tools-write.js'
export {
  lenientBool,
  lenientNumber,
  lenientNumberArray,
  lenientNullableNumber,
  lenientString,
  requireIds,
  storyboardFields,
  stripJunk,
  syncStoryboardCharacters,
  syncStoryboardProps,
  toCleanBool,
  toCleanNumber,
  toCleanNumberArray,
  toCleanNullableNumber,
  toCleanString,
  validateStoryboardBindings,
} from './storyboard-tools-shared.js'

export const storyboardTools = { readStoryboardContext, saveStoryboards, updateStoryboard }
