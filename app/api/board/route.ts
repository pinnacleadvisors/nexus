import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import type { KanbanCard, ColumnId, TaskType } from '@/lib/types'
import type { Database } from '@/lib/database.types'
import { audit } from '@/lib/audit'

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
  task_type?: string | null
  depends_on?: string[] | null
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
    taskType:     (row.task_type as TaskType | null) ?? 'automated',
    dependsOn:    row.depends_on ?? [],
  }
}

// ── Dependent-count + priority sort ──────────────────────────────────────────
// A manual task blocks every *incomplete* automated task that lists it in
// depends_on. We rank manual tasks by that blocking count so the owner can
// always see which manual step unlocks the most downstream automation.
function decorateAndSort(cards: KanbanCard[]): KanbanCard[] {
  const blocking = new Map<string, number>()
  for (const c of cards) {
    if (c.taskType !== 'automated' || c.columnId === 'completed') continue
    for (const depId of c.dependsOn ?? []) {
      blocking.set(depId, (blocking.get(depId) ?? 0) + 1)
    }
  }

  const decorated = cards.map(c =>
    c.taskType === 'manual'
      ? { ...c, dependentCount: blocking.get(c.id) ?? 0 }
      : c,
  )

  // Inside each column: manual tasks first, sorted by dependent count (desc),
  // then automated tasks in their existing order.
  const byColumn = new Map<ColumnId, KanbanCard[]>()
  for (const c of decorated) {
    const bucket = byColumn.get(c.columnId) ?? []
    bucket.push(c)
    byColumn.set(c.columnId, bucket)
  }

  const sorted: KanbanCard[] = []
  for (const [, bucket] of byColumn) {
    bucket.sort((a, b) => {
      if (a.taskType === 'manual' && b.taskType !== 'manual') return -1
      if (b.taskType === 'manual' && a.taskType !== 'manual') return 1
      if (a.taskType === 'manual' && b.taskType === 'manual') {
        return (b.dependentCount ?? 0) - (a.dependentCount ?? 0)
      }
      return 0
    })
    sorted.push(...bucket)
  }
  return sorted
}

// ── GET — list cards ──────────────────────────────────────────────────────────
//
// Always returns `{ cards: [], source }` — even on Supabase failure the `cards`
// field is present (empty) and `error` carries the human-readable reason. The
// frontend's `cardsToColumns(undefined)` previously crashed Sentry-style with
// "undefined is not an object" because the old shape on error was just
// `{error}` (no cards key). See app/(protected)/board/page.tsx loadError.
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get('project_id')
    const typeParam = req.nextUrl.searchParams.get('type') // 'manual' | 'automated' | null

    const db = createServerClient()
    if (!db) {
      // Supabase not configured — return seeded mock data (also decorated/sorted)
      let cards = INITIAL_COLUMNS.flatMap(col => col.cards)
      if (typeParam === 'manual' || typeParam === 'automated') {
        cards = cards.filter(c => (c.taskType ?? 'automated') === typeParam)
      }
      return NextResponse.json({ cards: decorateAndSort(cards), source: 'mock' })
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
    if (error) {
      return NextResponse.json({
        cards:  [],
        source: 'error',
        error:  error.message,
      }, { status: 200 })
    }

    // Always fetch the full set so dependent-counts stay accurate even when the
    // caller filtered by type. Filter after decoration.
    let cards = (data ?? []).map(rowToCard)
    cards = decorateAndSort(cards)
    if (typeParam === 'manual' || typeParam === 'automated') {
      cards = cards.filter(c => (c.taskType ?? 'automated') === typeParam)
    }

    return NextResponse.json({ cards, source: data?.length ? 'supabase' : 'empty' })
  } catch (err) {
    return NextResponse.json({
      cards:  [],
      source: 'error',
      error:  err instanceof Error ? err.message : String(err),
    }, { status: 200 })
  }
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
      task_type:    body.taskType    ?? 'automated',
      depends_on:   body.dependsOn   ?? [],
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
  if (body.taskType     !== undefined) update.task_type    = body.taskType
  if (body.dependsOn    !== undefined) update.depends_on   = body.dependsOn

  const { data, error } = await db
    .from('tasks')
    .update(update)
    .eq('id', body.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Audit column moves (approve = → completed, reject = → backlog)
  if (body.columnId) {
    const action =
      body.columnId === 'completed' ? 'board.approve' :
      body.columnId === 'backlog'   ? 'board.reject'  : 'board.move'
    audit(req, {
      action,
      resource: 'task',
      resourceId: body.id,
      metadata: { column: body.columnId, title: data.title },
    })
  }

  return NextResponse.json({ card: rowToCard(data) })
}

// ── DELETE — remove card ──────────────────────────────────────────────────────
// Owner-only. Required because the row-level RLS on `tasks` is bypassed by the
// service-role client this route uses, so we have to enforce ownership at the
// app layer. The hover trash icon on every Kanban card calls into this.
export async function DELETE(req: NextRequest) {
  try {
    const a = await auth()
    if (!a.userId) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }
    const allowed = (process.env.ALLOWED_USER_IDS ?? '')
      .split(',').map(s => s.trim()).filter(Boolean)
    if (allowed.length > 0 && !allowed.includes(a.userId)) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }

    let body: { id?: string }
    try {
      body = (await req.json()) as { id?: string }
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
    }
    const id = body.id?.trim()
    if (!id) {
      return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    }

    const db = createServerClient()
    if (!db) return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 })

    const { error } = await db.from('tasks').delete().eq('id', id)
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    audit(req, {
      action:     'board.card.delete',
      resource:   'tasks',
      resourceId: id,
      metadata:   { user_id: a.userId },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({
      ok:    false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }
}
