/**
 * POST /api/memory/pending-edges/:id/decide
 *   { decision: 'approve' | 'reject' }
 *
 * - approve → flip pending_approval=false, record decided_at + decided_by + decision='approve'.
 *             Edge becomes canonical immediately (walk + timeline include it).
 * - reject  → record decided_at + decided_by + decision='reject'. The row STAYS
 *             with pending_approval=true so a subsequent walk?include_pending=true
 *             still surfaces it for audit, but the default walk skips it.
 *             (We don't delete — keeping the row preserves the LLM's reasoning
 *             trail for prompt-tuning later.)
 *
 * Idempotent: re-deciding the same edge with the same decision is a no-op.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createServerClient } from '@/lib/supabase'

export const runtime     = 'nodejs'
export const maxDuration = 10

interface DecideBody { decision?: string }

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'memory:pending-edges:decide' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  let body: DecideBody = {}
  try { body = await req.json() } catch { /* validated below */ }
  if (body.decision !== 'approve' && body.decision !== 'reject') {
    return NextResponse.json({ ok: false, error: 'decision must be "approve" or "reject"' }, { status: 400 })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'db unavailable' }, { status: 200 })

  const updates: Record<string, unknown> = {
    decided_at: new Date().toISOString(),
    decided_by: session.userId,
    decision:   body.decision,
  }
  // Approval flips pending_approval=false; rejection leaves it true so the
  // edge stays out of default walks but is still auditable.
  if (body.decision === 'approve') updates.pending_approval = false

  const res = await (db.from('mol_edge' as never) as unknown as {
    update: (u: typeof updates) => { eq: (c: string, v: string) => { select: () => { single: () => Promise<{ data: unknown }> } } }
  }).update(updates).eq('id', id).select().single()

  if (!res.data) {
    return NextResponse.json({ ok: false, error: 'edge not found' }, { status: 200 })
  }
  return NextResponse.json({ ok: true, edge: res.data })
}
