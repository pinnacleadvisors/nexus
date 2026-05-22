/**
 * Server-side agent-spec reader. Walks `.claude/agents/*.md` at request time
 * and parses the YAML frontmatter into typed AgentSpec rows. Used by the
 * /agents profiling pages.
 *
 * Tiny YAML parser inline because the frontmatter is constrained:
 *   - scalars: name, description, model, transferable
 *   - comma-separated list: tools
 *   - YAML array (`- foo` lines): env
 *
 * No new dependency required.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

export interface AgentSpec {
  slug:         string
  name:         string
  description:  string
  tools:        string[]
  model:        string | null
  transferable: boolean
  env:          string[]
  /** Body of the markdown file with frontmatter stripped. Truncated for display. */
  body:         string
  /** Repo-relative path to the source file. */
  sourcePath:   string
}

const AGENTS_DIR = path.join(process.cwd(), '.claude', 'agents')

function splitFrontmatter(raw: string): { fm: string; body: string } {
  if (!raw.startsWith('---')) return { fm: '', body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { fm: '', body: raw }
  const fm = raw.slice(3, end).trim()
  const body = raw.slice(end + 4).replace(/^\s+/, '')
  return { fm, body }
}

function parseFrontmatter(fm: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  const lines = fm.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue }

    const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/.exec(line)
    if (!m) { i++; continue }
    const key = m[1]!
    const rest = (m[2] ?? '').trim()

    if (rest === '' || rest === '|' || rest === '|-' || rest === '>') {
      // Block scalar OR array. Look ahead at indented children.
      const children: string[] = []
      i++
      while (i < lines.length) {
        const next = lines[i] ?? ''
        if (!next.startsWith(' ') && !next.startsWith('\t') && next.trim() !== '') break
        // Array item
        const item = /^\s*-\s+(.+)$/.exec(next)
        if (item) children.push(item[1]!.trim())
        i++
      }
      out[key] = children
    } else {
      // Inline scalar — strip surrounding quotes if present.
      out[key] = rest.replace(/^['"]|['"]$/g, '')
      i++
    }
  }
  return out
}

function parseSpec(slug: string, raw: string, sourcePath: string): AgentSpec {
  const { fm, body } = splitFrontmatter(raw)
  const parsed = parseFrontmatter(fm)

  const tools = typeof parsed.tools === 'string'
    ? parsed.tools.split(',').map(s => s.trim()).filter(Boolean)
    : Array.isArray(parsed.tools) ? (parsed.tools as string[]) : []
  const env = Array.isArray(parsed.env) ? (parsed.env as string[]) : []
  const transferable = (parsed.transferable as string | undefined)?.toLowerCase() === 'true'

  return {
    slug,
    name:        (parsed.name as string) ?? slug,
    description: (parsed.description as string) ?? '',
    tools,
    model:       (parsed.model as string) ?? null,
    transferable,
    env,
    body,
    sourcePath,
  }
}

export async function listAgents(): Promise<AgentSpec[]> {
  let entries: string[] = []
  try {
    entries = await fs.readdir(AGENTS_DIR)
  } catch {
    return []
  }
  const mdFiles = entries.filter(e => e.endsWith('.md'))
  const specs = await Promise.all(mdFiles.map(async fname => {
    const slug = fname.replace(/\.md$/, '')
    const fullPath = path.join(AGENTS_DIR, fname)
    try {
      const raw = await fs.readFile(fullPath, 'utf8')
      return parseSpec(slug, raw, `.claude/agents/${fname}`)
    } catch {
      return null
    }
  }))
  return specs.filter((s): s is AgentSpec => s !== null).sort((a, b) => a.slug.localeCompare(b.slug))
}

export async function getAgent(slug: string): Promise<AgentSpec | null> {
  const fullPath = path.join(AGENTS_DIR, `${slug}.md`)
  try {
    const raw = await fs.readFile(fullPath, 'utf8')
    return parseSpec(slug, raw, `.claude/agents/${slug}.md`)
  } catch {
    return null
  }
}
