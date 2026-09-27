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
 * Agent 工作区装配（Mastra Workspace 原语）。
 *
 * 约定：backend/workspace/ 是所有 Agent 的文件系统 jail 根；技能 markdown 放
 * 在 skills 目录树的各层级（目录内含 SKILL.md 即算一个技能）。每种 agent type
 * 一个 Workspace 实例，
 * skills 走目录前缀的动态解析器——设置页新建技能目录后无需重启即可被感知。
 * instructions 注入时拼接 SKILL 全文（原生注入只有元数据列表，全文注入才行为稳定）。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Workspace, LocalFilesystem } from '@mastra/core/workspace'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACE_DIR = path.resolve(moduleDir, '../../workspace')
export const SKILLS_ROOT = path.join(WORKSPACE_DIR, 'skills')

// jail 根必须存在，否则 LocalFilesystem 初始化即炸
fs.mkdirSync(SKILLS_ROOT, { recursive: true })

/** agent type → 技能目录前缀（相对 skills/；目录名遵循小写+连字符的 Agent Skills 规范） */
const AGENT_SKILL_MAP: Record<string, string[]> = {
  script_rewriter: ['script-rewriter'],
  extractor: ['extractor'],
  storyboard_breaker: ['storyboard-breaker'],
  prompt_generator: [
    'prompt-generator/character-prompt',
    'prompt-generator/scene-prompt',
    'prompt-generator/prop-prompt',
    'prompt-generator/video-prompt',
  ],
  // 小说自动分集的命名/概要规范
  novel_splitter: ['novel-splitter'],
}

/** 深度遍历 skills/，收集一切放着 SKILL.md 的目录（返回 `skills/<相对路径>`） */
function scanSkillPaths(): string[] {
  const hitDirs: string[] = []
  const dive = (absDir: string, relPrefix: string) => {
    if (!fs.existsSync(absDir)) return
    for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue
      const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name
      const abs = path.join(absDir, ent.name)
      if (fs.existsSync(path.join(abs, 'SKILL.md'))) hitDirs.push(`skills/${rel}`)
      dive(abs, rel)
    }
  }
  dive(SKILLS_ROOT, '')
  return hitDirs
}

/** 前缀匹配：目录本身或其任意子层都算命中（设置页加子技能无需改代码） */
const underPrefix = (relPath: string, prefixes: string[]) =>
  prefixes.some(p => relPath === p || relPath.startsWith(`${p}/`))

/** 每种 Agent 的 Workspace：同一 filesystem + 各自前缀过滤后的技能集 */
export const skillWorkspaces: Record<string, Workspace> = Object.fromEntries(
  Object.entries(AGENT_SKILL_MAP).map(([agentType, prefixes]) => [agentType, new Workspace({
    id: `workspace-${agentType}`,
    name: `${agentType} workspace`,
    filesystem: new LocalFilesystem({ basePath: WORKSPACE_DIR }),
    skills: () => scanSkillPaths().filter(p => underPrefix(p.replace(/^skills\//, ''), prefixes)),
  })]),
)

/** 设置页技能 CRUD 专用的管理 Workspace（不加前缀过滤，看得到全部技能） */
export const skillsManagerWorkspace = new Workspace({
  id: 'workspace-skills-manager',
  name: 'skills manager',
  filesystem: new LocalFilesystem({ basePath: WORKSPACE_DIR }),
  skills: () => scanSkillPaths(),
})

/**
 * 技能根目录不存在 → true（多半是部署没同步 backend/workspace/skills）。
 * GET /skills 借此把「环境缺目录」与「真的没有技能」分开报，不让空数组静默背锅。
 */
export function skillsRootMissing(): boolean {
  return !fs.existsSync(SKILLS_ROOT)
}

/**
 * 拼出注入给某 Agent 的技能规范全文；无命中返回空串。
 * 格式沿用固定样板：一句总则 + 每个技能一节「## Skill: <相对路径>」。
 */
export async function loadAgentSkills(agentType: string): Promise<string> {
  const workspace = skillWorkspaces[agentType]
  const prefixes = AGENT_SKILL_MAP[agentType] ?? []
  if (!workspace || prefixes.length === 0) return ''

  const sections: string[] = []
  for (const rel of scanSkillPaths().map(p => p.replace(/^skills\//, '')).filter(p => underPrefix(p, prefixes))) {
    const body = (await workspace.skills?.get(`skills/${rel}`))?.instructions?.trim()
    if (body) sections.push(`## Skill: ${rel}\n${body}`)
  }
  if (!sections.length) return ''

  return [
    '以下为当前 Agent 装载的项目技能规范（SKILL.md 全文）。',
    '不同 Agent 装载的技能不同，你只需遵循眼前注入的这些技能。',
    '在不超出当前工具边界的前提下优先服从这些规范；与用户明确要求冲突时，以用户要求为准。',
    '',
    sections.join('\n\n'),
  ].join('\n')
}

/**
 * SKILL.md 被编辑后强制全量重扫。
 * 两段都要：maybeRefresh 只盯目录增删（动态 resolver 路径变化），
 * 而改文件内容不动目录 mtime，staleness 检查会漏，必须再显式 refresh。
 */
export async function refreshSkillWorkspaces(): Promise<void> {
  await Promise.all(
    [...Object.values(skillWorkspaces), skillsManagerWorkspace].map(async ws => {
      await ws.skills?.maybeRefresh()
      await ws.skills?.refresh()
    }),
  )
}
