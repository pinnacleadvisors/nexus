/**
 * Agent library CRUD — persists Claude managed agent specs so they survive
 * across sessions and are queryable from the UI.
 *
 * GET  /api/agents          — list the signed-in user's agent specs (newest first)
 * POST /api/agents          — upsert an AgentDefinition (source of truth: the
 *                             `.claude/agents/<slug>.md` file; this route mirrors it)
 *
 * When Supabase is not configured, GET returns an empty list and POST returns
 * 503 — the markdown file on disk is still the authoritative spec.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import type { AgentDefinition } from '@/lib/types'

export const runtime = 'nodejs'

interface AgentRow {
  id: string
  user_id: string
  slug: string
  name: string
  description: string
  tools: string[]
  model: string
  transferable: boolean
  env_vars: string[]
  system_prompt: string
  source_path: string | null
  version: number
  created_at: string
  updated_at: string
}

function rowToAgent(row: AgentRow): AgentDefinition {
  return {
    id:           row.id,
    slug:         row.slug,
    name:         row.name,
    description:  row.description,
    tools:        row.tools,
    model:        row.model,
    transferable: row.transferable,
    envVars:      row.env_vars,
    systemPrompt: row.system_prompt,
    sourcePath:   row.source_path ?? undefined,
    version:      row.version,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  }
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const db = createServerClient()
  if (!db) return NextResponse.json({ agents: [] })

  // agent_library is not yet in the generated Database type — cast.
  const { data, error } = await (db.from('agent_library' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        order: (c: string, o: { ascending: boolean }) => Promise<{ data: AgentRow[] | null; error: { message: string } | null }>
      }
    }
  })
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = (data ?? []) as AgentRow[]
  return NextResponse.json({ agents: rows.map(rowToAgent) })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const db = createServerClient()
  if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })

  const body = (await req.json()) as Partial<AgentDefinition>
  if (!body.slug || !body.name || !body.description || !body.systemPrompt) {
    return NextResponse.json({ error: 'slug, name, description, systemPrompt required' }, { status: 400 })
  }

  const record = {
    user_id:       userId,
    slug:          body.slug,
    name:          body.name,
    description:   body.description,
    tools:         body.tools ?? [],
    model:         body.model ?? 'claude-sonnet-4-6',
    transferable:  body.transferable ?? true,
    env_vars:      body.envVars ?? [],
    system_prompt: body.systemPrompt,
    source_path:   body.sourcePath ?? null,
    updated_at:    new Date().toISOString(),
  }

  const { data, error } = await (db.from('agent_library' as never) as unknown as {
    upsert: (rec: unknown, opts: { onConflict: string }) => {
      select: () => { single: () => Promise<{ data: AgentRow | null; error: { message: string } | null }> }
    }
  })
    .upsert(record, { onConflict: 'user_id,slug' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ agent: rowToAgent(data as AgentRow) }, { status: 201 })
}
