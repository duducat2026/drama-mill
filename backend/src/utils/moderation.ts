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
 * 内容安全审核（绿网）拦截识别 — 关键词集合的唯一定义处。
 *
 * 为什么单独成文件：绿网自动修正链路（services/moderation-fix.ts）与失败原因诊断
 * （services/failure-detail.ts）都要判「这次失败是不是审核拦的」，但结论用途不同：
 * 前者据此改写提示词并重提，后者只负责告诉用户「与 Key/端点无关」。
 * 判定放 util 层（零依赖、可被单测直接 import）以免两处关键词各写一份慢慢漂移，
 * 也避免诊断模块为了一个正则去 import 整条 DB / 生成链路。
 */

/** 审核类错误特征：中英混杂的上游文案 + 常见的 data inspection 错误码 */
export const MODERATION_ERROR_PATTERN = /绿网|green.?net|data.?inspection|sensitive|moderation|content.?policy|inappropriate|内容审核|审核拦截|审核未通过|违规|违禁|涉政|敏感内容|不当内容/i

/** 是否命中内容审核类错误（空值一律 false，不含凭证/参数类误伤） */
export function isModerationError(msg: string | null | undefined): boolean {
  return !!msg && MODERATION_ERROR_PATTERN.test(msg)
}
