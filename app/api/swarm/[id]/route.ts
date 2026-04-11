/**
 * GET  /api/swarm/:id  — returns current swarm run state + tasks
 * DELETE /api/swarm/:id — marks swarm as aborted
 */

import { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { audit } from '@/lib/audit'

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db     = createServerClient()

  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not configured.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const [runResult, tasksResult] = await Promise.all([
    db.from('swarm_runs').select('*').eq('id', id).single(),
    db.from('swarm_tasks').select('*').eq('swarm_id', id).order('phase').order('created_at'),
  ])

  if (runResult.error || !runResult.data) {
    return new Response(JSON.stringify({ error: 'Swarm run not found.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({
    run:   runResult.data,
    tasks: tasksResult.data ?? [],
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

// ── DELETE ────────────────────────────────────────────────────────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db     = createServerClient()

  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not configured.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { error } = await db
    .from('swarm_runs')
    .update({ status: 'aborted', updated_at: new Date().toISOString() })
    .eq('id', id)
    .neq('status', 'completed')

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  audit(req, {
    action:     'swarm.abort',
    resource:   'swarm',
    resourceId: id,
  })

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
