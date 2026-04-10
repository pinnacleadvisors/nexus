import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import type { KanbanCard, ColumnId } from '@/lib/types'
import type { Database } from '@/lib/database.types'

type TaskUpdate = Database['public']['Tables']['tasks']['Update']
import { INITIAL_COLUMNS } from '@/lib/mock-data'

export const runtime = 'nodejs'

// ── Shape helper ──────────────────────────────────────────────────────────────
function rowToCard(row: {
  id: string
  project_id: string | null
  title: string
  description: string
  column_id: string
  assignee: string | null
  priority: string
  asset_url: string | null
  revision_note: string | null
  milestone_id: string | null
  created_at: string
}): KanbanCard {
  return {
    id:           row.id,
    projectId:    row.project_id ?? undefined,
    title:        row.title,
    description:  row.description,
    columnId:     row.column_id as ColumnId,
    assignee:     row.assignee ?? undefined,
    priority:     row.priority as KanbanCard['priority'],
    assetUrl:     row.asset_url ?? undefined,
    revisionNote: row.revision_note ?? undefined,
    milestoneId:  row.milestone_id ?? undefined,
    createdAt:    row.created_at,
  }
}

// ── GET — list cards ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('project_id')

  const db = createServerClient()
  if (!db) {
    // Supabase not configured — return seeded mock data
    const cards = INITIAL_COLUMNS.flatMap(col => col.cards)
    return NextResponse.json({ cards, source: 'mock' })
  }

  let query = db
    .from('tasks')
    .select('*')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (projectId) {
    query = query.eq('project_id', projectId)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const cards = (data ?? []).map(rowToCard)
  return NextResponse.json({ cards, source: data?.length ? 'supabase' : 'empty' })
}

// ── POST — create card ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json() as Partial<KanbanCard>

  const db = createServerClient()
  if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })

  const { data, error } = await db
    .from('tasks')
    .insert({
      project_id:   body.projectId   ?? null,
      title:        body.title       ?? 'Untitled',
      description:  body.description ?? '',
      column_id:    body.columnId    ?? 'backlog',
      assignee:     body.assignee    ?? null,
      priority:     body.priority    ?? 'medium',
      asset_url:    body.assetUrl    ?? null,
      milestone_id: body.milestoneId ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ card: rowToCard(data) })
}

// ── PATCH — update card (column move, approve, reject) ────────────────────────
export async function PATCH(req: NextRequest) {
  const body = await req.json() as Partial<KanbanCard> & { id: string }

  const db = createServerClient()
  if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })

  const update: TaskUpdate = {}
  if (body.columnId     !== undefined) update.column_id    = body.columnId
  if (body.priority     !== undefined) update.priority     = body.priority
  if (body.revisionNote !== undefined) update.revision_note = body.revisionNote
  if (body.assetUrl     !== undefined) update.asset_url    = body.assetUrl
  if (body.assignee     !== undefined) update.assignee     = body.assignee
  if (body.projectId    !== undefined) update.project_id   = body.projectId

  const { data, error } = await db
    .from('tasks')
    .update(update)
    .eq('id', body.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ card: rowToCard(data) })
}

// ── DELETE — remove card ──────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const { id } = await req.json() as { id: string }

  const db = createServerClient()
  if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })

  const { error } = await db.from('tasks').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
