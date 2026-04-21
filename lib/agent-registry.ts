/**
 * Agent registry — bridges the filesystem source-of-truth (`.claude/agents/*.md`)
 * with the Supabase `agent_library` table.
 *
 * The markdown file is canonical. Supabase is a projection that lets the UI
 * query agents, list them in /tools/agents, and surface them to runtime code.
 */

import type { AgentDefinition } from './types'

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

interface ParsedFrontmatter {
  name?: string
  description?: string
  tools?: string[]
  model?: string
  transferable?: boolean
  envVars?: string[]
}

/**
 * Parse a `.claude/agents/<slug>.md` file into an AgentDefinition.
 * Intentionally dependency-free — runs in Node and the browser.
 */
export function parseAgentMarkdown(slug: string, raw: string, sourcePath?: string): AgentDefinition {
  const match = raw.match(FRONTMATTER_RE)
  if (!match) {
    throw new Error(`Agent spec ${slug} is missing YAML frontmatter`)
  }

  const fm = parseFrontmatter(match[1])
  const body = match[2].trim()

  return {
    slug,
    name: fm.name ?? slug,
    description: fm.description ?? '',
    tools: fm.tools ?? [],
    model: fm.model ?? 'claude-sonnet-4-6',
    transferable: fm.transferable ?? true,
    envVars: fm.envVars ?? [],
    systemPrompt: body,
    sourcePath,
  }
}

/**
 * Extremely small YAML parser — handles the subset we use in agent frontmatter:
 *   - `key: value` scalars
 *   - `key: [a, b]` inline arrays
 *   - `key:` followed by `  - item` block lists
 *   - comments (# ...) on any line
 * We deliberately do not pull in `js-yaml` because this file is consumed from
 * both server and edge contexts.
 */
function parseFrontmatter(src: string): ParsedFrontmatter {
  const out: Record<string, unknown> = {}
  const lines = src.split('\n')

  let i = 0
  while (i < lines.length) {
    const line = stripComment(lines[i])
    if (!line.trim()) { i++; continue }

    const scalar = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/)
    if (!scalar) { i++; continue }

    const key = scalar[1]
    const value = scalar[2].trim()

    if (value === '') {
      // block list or empty
      const items: string[] = []
      i++
      while (i < lines.length) {
        const next = stripComment(lines[i])
        const item = next.match(/^\s+-\s+(.*)$/)
        if (!item) break
        items.push(unquote(item[1]))
        i++
      }
      out[key] = items
      continue
    }

    if (value.startsWith('[') && value.endsWith(']')) {
      out[key] = value
        .slice(1, -1)
        .split(',')
        .map(s => unquote(s.trim()))
        .filter(Boolean)
      i++
      continue
    }

    if (value === 'true' || value === 'false') {
      out[key] = value === 'true'
      i++
      continue
    }

    out[key] = unquote(value)
    i++
  }

  // Normalise `tools` — accept CSV scalar as a courtesy ("tools: Read, Bash")
  if (typeof out.tools === 'string') {
    out.tools = (out.tools as string).split(',').map(s => s.trim()).filter(Boolean)
  }

  // `env` → envVars
  if (Array.isArray(out.env)) {
    out.envVars = out.env
    delete out.env
  }

  return out as ParsedFrontmatter
}

function stripComment(line: string): string {
  const hash = line.indexOf('#')
  if (hash === -1) return line
  // keep `#` inside quoted strings
  const before = line.slice(0, hash)
  const quotes = (before.match(/["']/g) ?? []).length
  return quotes % 2 === 0 ? before : line
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Serialize an AgentDefinition back into markdown (for round-trip edits).
 */
export function agentToMarkdown(agent: AgentDefinition): string {
  const lines: string[] = ['---']
  lines.push(`name: ${agent.slug}`)
  lines.push(`description: ${escapeForYaml(agent.description)}`)
  lines.push(`tools: ${agent.tools.join(', ')}`)
  lines.push(`model: ${agent.model}`)
  lines.push(`transferable: ${agent.transferable}`)
  if (agent.envVars.length) {
    lines.push('env:')
    for (const v of agent.envVars) lines.push(`  - ${v}`)
  } else {
    lines.push('env: []')
  }
  lines.push('---')
  lines.push('')
  lines.push(agent.systemPrompt.trim())
  return lines.join('\n') + '\n'
}

function escapeForYaml(value: string): string {
  // Colons or leading special chars need quoting for safety.
  if (/[:#]|^[-*?&!|>'"%@`]/.test(value)) {
    return JSON.stringify(value)
  }
  return value
}
