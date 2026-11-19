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
 * 登录限流 — 按「账号 + 来源 IP」组合键统计失败次数，防口令爆破。
 *
 * 组合键而非单一维度：只按账号会被换 IP 绕过，只按 IP 会误伤同一出口后的
 * 其他用户（公司/校园 NAT）。窗口 5 分钟内失败满 5 次即锁定 15 分钟，
 * 成功登录立刻清零。计数只存进程内存：单实例 fork 部署够用，
 * 多实例场景需换成 Redis 等共享存储（当前部署形态为单实例）。
 */

const MAX_ATTEMPTS = 5
const WINDOW_MS = 5 * 60 * 1000    // 5 分钟内累计失败
const LOCKOUT_MS = 15 * 60 * 1000  // 触发后锁定时长

interface AttemptRecord {
  count: number
  firstAttempt: number
  lockedUntil?: number
}

const attempts = new Map<string, AttemptRecord>()

function key(username: string, ip: string): string {
  return `${username}:${ip}`
}

/** 该记录是否已过期（锁定期满或统计窗口已过） */
function isExpired(record: AttemptRecord, now: number): boolean {
  if (record.lockedUntil) return now >= record.lockedUntil
  return now - record.firstAttempt > WINDOW_MS
}

/** 锁定中返回提示文案，放行返回 null */
export function checkLoginLimit(username: string, ip: string): string | null {
  const k = key(username, ip)
  const record = attempts.get(k)
  if (!record) return null

  const now = Date.now()

  // 锁定未到期：直接拒绝，并告知剩余分钟数
  if (record.lockedUntil && now < record.lockedUntil) {
    const remaining = Math.ceil((record.lockedUntil - now) / 60000)
    return `登录失败次数过多，请 ${remaining} 分钟后再试`
  }

  // 锁定已到期 / 统计窗口已过：清掉旧账，重新计数
  if (isExpired(record, now)) {
    attempts.delete(k)
    return null
  }

  return null
}

/** 记录一次失败；同一窗口内累计到上限即锁定 */
export function recordLoginFailure(username: string, ip: string): void {
  const k = key(username, ip)
  const now = Date.now()
  const record = attempts.get(k)

  if (!record || now - record.firstAttempt > WINDOW_MS) {
    attempts.set(k, { count: 1, firstAttempt: now })
    return
  }

  record.count++
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS
  }
}

/** 登录成功后清零：避免正常用户的历史失败累积到锁定 */
export function resetLoginAttempts(username: string, ip: string): void {
  attempts.delete(key(username, ip))
}

/** 仅供测试/运维观测：当前被跟踪的键数量 */
export function loginAttemptTrackerSize(): number {
  return attempts.size
}

// 定期清理过期条目，防止 Map 随攻击者构造的海量账号/IP 无限增长（unref 不阻塞进程退出）
setInterval(() => {
  const now = Date.now()
  for (const [k, record] of attempts) {
    if (isExpired(record, now)) attempts.delete(k)
  }
}, 10 * 60 * 1000).unref()
