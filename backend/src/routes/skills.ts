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
 * 技能（SKILL.md）管理接口
 * 一切读写都走 Mastra Workspace 的文件 API，天然 jail 在 backend/workspace/ 里；
 * 技能属平台级配置，只有管理员能动：整路由前置 adminGuard。
 * 运行时 Agent 从文件层加载技能，不依赖这组 HTTP。
 */
import { Hono } from 'hono'
import { success, badRequest } from '../utils/response.js'
import { adminGuard } from '../middleware/auth.js'
import { refreshSkillWorkspaces, skillsManagerWorkspace, skillsRootMissing, SKILLS_ROOT } from '../agents/skills.js'

const app = new Hono()
app.use('*', adminGuard)
const fsm = () => skillsManagerWorkspace.filesystem!
const skillFile = (id: string) => `skills/${id}/SKILL.md`
// Mastra 规范：技能目录名（= frontmatter name）只允许小写字母、数字、连字符
const SKILL_ID_SEGMENT = /^[a-z0-9-]+$/

// 通配路由下从 path 截出技能 id（支持带层级的 id）
const idFromPath = (path: string) => path.slice('/api/v1/skills/'.length)

// GET /skills — 列表：交给 workspace.skills 原生发现，只吐 id/名称/描述
app.get('/', async (c) => {
  const metas = await skillsManagerWorkspace.skills?.list() || []
  if (metas.length === 0) {
    // 启动时已 mkdirSync 保证目录存在，空列表大概率是部署没带技能文件，打日志帮运维定位
    const hint = skillsRootMissing() ? '目录不存在' : '目录存在但无 SKILL.md（很可能部署未同步技能文件）'
    console.warn(`[skills] 未发现任何技能，${hint}：${SKILLS_ROOT}`)
  }
  return success(c, metas.map(meta => ({
    id: meta.path.replace(/^skills\//, ''),
    name: meta.name,
    description: meta.description || '',
  })))
})

// GET /skills/* — 读原文（含 frontmatter，前端编辑器直接吃这份）
app.get('/*', async (c) => {
  const id = idFromPath(c.req.path)
  if (!await fsm().exists(skillFile(id))) return badRequest(c, 'Skill not found')
  const content = await fsm().readFile(skillFile(id), { encoding: 'utf-8' })
  return success(c, { id, content })
})

// PUT /skills/* — 保存正文
app.put('/*', async (c) => {
  const id = idFromPath(c.req.path)
  const body = await c.req.json()
  await fsm().writeFile(skillFile(id), body.content, { recursive: true })
  // 改文件内容不会带动目录 mtime（APFS 语义），Workspace 技能缓存要显式刷
  await refreshSkillWorkspaces()
  return success(c)
})

// POST /skills — 新建技能目录 + 初始 SKILL.md 骨架
app.post('/', async (c) => {
  const body = await c.req.json()
  const { id, description } = body
  if (!id) return badRequest(c, 'Skill id is required')
  const segments = String(id).split('/')
  if (!segments.every((seg: string) => SKILL_ID_SEGMENT.test(seg))) {
    return badRequest(c, 'Skill id 每段只能包含小写字母、数字和连字符')
  }
  if (await fsm().exists(skillFile(id))) return badRequest(c, 'Skill already exists')

  const name = segments[segments.length - 1]
  const content = [
    '---',
    `name: ${name}`,
    `description: ${description || ''}`,
    '---',
    '',
    `# ${name}`,
    '',
    '在这里编写技能说明。',
    '',
  ].join('\n')
  await fsm().writeFile(skillFile(id), content, { recursive: true, overwrite: false })
  await refreshSkillWorkspaces()
  return success(c, { id, name, description: description || '' })
})

// DELETE /skills/* — 整目录移除
app.delete('/*', async (c) => {
  const id = idFromPath(c.req.path)
  if (!await fsm().exists(`skills/${id}`)) return badRequest(c, 'Skill not found')
  await fsm().rmdir(`skills/${id}`, { recursive: true })
  await refreshSkillWorkspaces()
  return success(c)
})

export default app
