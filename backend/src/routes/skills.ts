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
 * 技能管理路由 — 全部经 Mastra Workspace API 读写
 * 文件操作 jail 在 backend/workspace/ 目录内
 * 平台级配置仅管理员可改：挂 adminGuard（运行时 Agent 直接读文件，不经此 HTTP 层）
 */
import { Hono } from 'hono'
import { success, badRequest } from '../utils/response.js'
import { adminGuard } from '../middleware/auth.js'
import { refreshSkillWorkspaces, skillsManagerWorkspace, skillsRootMissing, SKILLS_ROOT } from '../agents/skills.js'

const app = new Hono()
app.use('*', adminGuard)
const fsm = () => skillsManagerWorkspace.filesystem!
const skillFile = (id: string) => `skills/${id}/SKILL.md`
const SKILL_ID_SEGMENT = /^[a-z0-9-]+$/

// GET /skills — List all skills (经 workspace.skills 原生发现)
app.get('/', async (c) => {
  const metas = await skillsManagerWorkspace.skills?.list() || []
  // 发现为空时输出可运维的定位日志：启动时 mkdirSync 会保证目录存在，
  // 因此「空列表」通常是部署未同步 backend/workspace/skills/**/SKILL.md 所致
  if (metas.length === 0) {
    const hint = skillsRootMissing() ? '目录不存在' : '目录存在但无 SKILL.md（很可能部署未同步技能文件）'
    console.warn(`[skills] 未发现任何技能，${hint}：${SKILLS_ROOT}`)
  }
  return success(c, metas.map(meta => ({
    id: meta.path.replace(/^skills\//, ''),
    name: meta.name,
    description: meta.description || '',
  })))
})

// GET /skills/:id — Get skill content (raw, 含 frontmatter 供编辑)
app.get('/*', async (c) => {
  const id = c.req.path.slice('/api/v1/skills/'.length)
  if (!await fsm().exists(skillFile(id))) return badRequest(c, 'Skill not found')
  const content = await fsm().readFile(skillFile(id), { encoding: 'utf-8' })
  return success(c, { id, content })
})

// PUT /skills/:id — Update skill content
app.put('/*', async (c) => {
  const id = c.req.path.slice('/api/v1/skills/'.length)
  const body = await c.req.json()
  await fsm().writeFile(skillFile(id), body.content, { recursive: true })
  // 目录 mtime 不会因文件内容编辑而更新（APFS），显式刷新技能缓存
  await refreshSkillWorkspaces()
  return success(c)
})

// POST /skills — Create new skill directory
app.post('/', async (c) => {
  const body = await c.req.json()
  const { id, description } = body
  if (!id) return badRequest(c, 'Skill id is required')
  // Mastra 技能规范：frontmatter name 必须与目录名一致，且只允许小写字母/数字/连字符
  const segments = String(id).split('/')
  if (!segments.every((seg: string) => SKILL_ID_SEGMENT.test(seg))) {
    return badRequest(c, 'Skill id 每段只能包含小写字母、数字和连字符')
  }
  if (await fsm().exists(skillFile(id))) return badRequest(c, 'Skill already exists')

  const name = segments[segments.length - 1]
  const content = `---
name: ${name}
description: ${description || ''}
---

# ${name}

Write your skill content here.
`
  await fsm().writeFile(skillFile(id), content, { recursive: true, overwrite: false })
  await refreshSkillWorkspaces()
  return success(c, { id, name, description: description || '' })
})

// DELETE /skills/:id — Delete skill directory
app.delete('/*', async (c) => {
  const id = c.req.path.slice('/api/v1/skills/'.length)
  if (!await fsm().exists(`skills/${id}`)) return badRequest(c, 'Skill not found')
  await fsm().rmdir(`skills/${id}`, { recursive: true })
  await refreshSkillWorkspaces()
  return success(c)
})

export default app
