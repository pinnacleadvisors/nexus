/**
 * Managed agents listing — reads the `.claude/agents/*.md` specs directly from
 * disk so the UI works regardless of whether the Supabase projection is
 * populated. The markdown file is the source of truth (see lib/agent-registry).
 *
 * GET /api/agents/managed      — list all managed agent specs
 *     ?slug=<slug>             — return a single spec
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseAgentMarkdown } from '@/lib/agent-registry'
import type { AgentDefinition } from '@/lib/types'

export const runtime = 'nodejs'

const AGENTS_DIR = join(process.cwd(), '.claude', 'agents')

async function loadSpec(slug: string): Promise<AgentDefinition | null> {
  try {
    const path = join(AGENTS_DIR, `${slug}.md`)
    const raw = await readFile(path, 'utf8')
    return parseAgentMarkdown(slug, raw, `.claude/agents/${slug}.md`)
  } catch {
    return null
  }
}

async function loadAll(): Promise<AgentDefinition[]> {
  let entries: string[]
  try {
    entries = await readdir(AGENTS_DIR)
  } catch {
    return []
  }

  const slugs = entries
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, ''))

  const specs = await Promise.all(slugs.map(loadSpec))
  return specs
    .filter((s): s is AgentDefinition => s !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const slug = req.nextUrl.searchParams.get('slug')
  if (slug) {
    const spec = await loadSpec(slug)
    if (!spec) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json({ agent: spec })
  }

  const agents = await loadAll()
  return NextResponse.json({ agents })
}
