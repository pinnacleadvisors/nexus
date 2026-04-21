/**
 * Workflow feedback capture — review-node textarea POSTs here when the user
 * is unhappy with an agent output. The workflow-optimizer managed agent reads
 * unresolved rows, proposes a diff, and eventually writes a workflow_changelog
 * row with before/after snapshots.
 *
 * POST /api/workflow-feedback       — insert a feedback row
 *      body: { cardId?, agentSlug?, feedback, artifactUrl? }
 *      returns: { ok, feedbackId }
 *
 * GET  /api/workflow-feedback       — list the signed-in user's feedback rows
 *      query: ?status=open|triaged|applied|rejected (optional)
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import type { WorkflowFeedback } from '@/lib/types'

export const runtime = 'nodejs'

interface FeedbackRow {
  id: string
  user_id: string
  card_id: string | null
  agent_slug: string | null
  feedback: string
  status: WorkflowFeedback['status']
  artifact_url: string | null
  created_at: string
  resolved_at: string | null
}

function rowToFeedback(row: FeedbackRow): WorkflowFeedback {
  return {
    id:          row.id,
    cardId:      row.card_id ?? undefined,
    agentSlug:   row.agent_slug ?? undefined,
    feedback:    row.feedback,
    status:      row.status,
    artifactUrl: row.artifact_url ?? undefined,
    createdAt:   row.created_at,
    resolvedAt:  row.resolved_at ?? undefined,
  }
}

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const status = req.nextUrl.searchParams.get('status') as WorkflowFeedback['status'] | null

  const db = createServerClient()
  if (!db) return NextResponse.json({ feedback: [] })

  const builder = (db.from('workflow_feedback' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => {
          order: (c: string, o: { ascending: boolean }) => Promise<{ data: FeedbackRow[] | null; error: { message: string } | null }>
        }
        order: (c: string, o: { ascending: boolean }) => Promise<{ data: FeedbackRow[] | null; error: { message: string } | null }>
      }
    }
  }).select('*').eq('user_id', userId)

  const { data, error } = status
    ? await builder.eq('status', status).order('created_at', { ascending: false })
    : await builder.order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ feedback: (data ?? []).map(rowToFeedback) })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json()) as {
    cardId?: string
    agentSlug?: string
    feedback?: string
    artifactUrl?: string
  }
  const feedback = body.feedback?.trim()
  if (!feedback) {
    return NextResponse.json({ error: 'feedback required' }, { status: 400 })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })

  const record = {
    user_id:      userId,
    card_id:      body.cardId      ?? null,
    agent_slug:   body.agentSlug   ?? null,
    feedback,
    artifact_url: body.artifactUrl ?? null,
    status:       'open' as const,
  }

  const { data, error } = await (db.from('workflow_feedback' as never) as unknown as {
    insert: (rec: unknown) => {
      select: () => { single: () => Promise<{ data: FeedbackRow | null; error: { message: string } | null }> }
    }
  })
    .insert(record)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, feedbackId: data?.id ?? null }, { status: 201 })
}
