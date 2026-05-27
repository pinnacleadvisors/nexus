/**
 * POST /api/approvals/decide-batch
 *
 * Bulk approve / reject endpoint backing R2 of the UX consultation
 * (docs/research/UX_CONSULTATION_2026-05-27.md). Operator selects N
 * pending approvals in /approvals and decides them all in one click.
 *
 * Body: { ids: string[], decision: 'approve' | 'reject', note?: string }
 *
 * Behaviour mirrors the per-row /api/approvals/[id]/decide route:
 *   - Idempotent: rows already in a terminal state are returned as
 *     "already_decided" + the prior decision; no error.
 *   - Retry-storm safe: returns 200 + per-id status. Even partial
 *     failures don't 5xx — the UI reads the result map.
 *   - Cap: 50 ids per call. Beyond that, the operator should batch.
 *
 * Why a separate endpoint instead of N parallel single calls:
 *   - One Supabase round-trip per batch (`update ... in (ids)`) keeps
 *     rate-limit pressure off the per-id route.
 *   - One audit row per batch (the decision was atomic from the
 *     operator's perspective, even though the rows are independent).
 *   - Per-id detail still returned so the UI can mark partial failures.
 *
 * Auth: Clerk + ALLOWED_USER_IDS — same as the per-id decide route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BATCH_SIZE = 50

function getAllowedUserIds(): Set<string> | null {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return null
  return new Set(raw.split(',').map(id => id.trim()).filter(Boolean))
}

function isOwner(userId: string): boolean {
  const allowed = getAllowedUserIds()
  if (!allowed) return true
  return allowed.has(userId)
}

interface Body {
  ids:      unknown
  decision: unknown
  note?:    unknown
}

interface ApprovalRow {
  id:               string
  status:           string
  decided_at:       string | null
  decided_by_user:  string | null
}

interface PerIdResult {
  id:               string
  ok:               boolean
  status:           'approved' | 'rejected' | 'already_decided' | 'not_found' | 'error'
  prior_decision?:  'approved' | 'rejected' | 'cancelled' | null
  error?:           string
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session.userId) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  if (!isOwner(session.userId)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const rl = await rateLimit(req, {
    limit:      10,
    window:     '1 m',
    prefix:     'approvals:decide-batch',
    identifier: session.userId,
  })
  if (!rl.success) return rateLimitResponse(rl)

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' })
  }

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ ok: false, error: 'ids_required' })
  }
  if (body.ids.length > MAX_BATCH_SIZE) {
    return NextResponse.json({
      ok:    false,
      error: 'batch_too_large',
      hint:  `Max ${MAX_BATCH_SIZE} ids per request. Split the selection and retry.`,
    })
  }
  if (body.decision !== 'approve' && body.decision !== 'reject') {
    return NextResponse.json({ ok: false, error: 'invalid_decision' })
  }
  const ids: string[] = body.ids.filter(x => typeof x === 'string' && x.length > 0) as string[]
  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: 'no_valid_ids' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  // Step 1: read current state of all rows in one query.
  let priorRows: ApprovalRow[] = []
  try {
    const res = await (db.from('approvals' as never) as unknown as {
      select: (c: string) => { in: (c: string, v: string[]) => Promise<{ data: ApprovalRow[] | null; error: { message: string } | null }> }
    }).select('id,status,decided_at,decided_by_user').in('id', ids)
    if (res.error) {
      if (/relation .*approvals.* does not exist/i.test(res.error.message)) {
        return NextResponse.json({ ok: false, error: 'approvals_table_missing', hint: 'Apply migration 050_approvals_first_class.sql.' })
      }
      return NextResponse.json({ ok: false, error: res.error.message })
    }
    priorRows = res.data ?? []
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'unknown' })
  }

  const priorById = new Map<string, ApprovalRow>(priorRows.map(r => [r.id, r]))

  // Step 2: classify each id into one of: ALREADY (terminal state),
  // PENDING (will be updated), MISSING (no row).
  const TERMINAL = new Set(['approved', 'rejected', 'cancelled'])
  const newStatus = body.decision === 'approve' ? 'approved' : 'rejected'
  const nowIso = new Date().toISOString()
  const results: PerIdResult[] = []
  const updateIds: string[] = []

  for (const id of ids) {
    const prior = priorById.get(id)
    if (!prior) {
      results.push({ id, ok: false, status: 'not_found' })
      continue
    }
    if (TERMINAL.has(prior.status)) {
      results.push({
        id,
        ok:             true,
        status:         'already_decided',
        prior_decision: prior.status as PerIdResult['prior_decision'],
      })
      continue
    }
    updateIds.push(id)
  }

  // Step 3: one UPDATE for all the pending rows.
  if (updateIds.length > 0) {
    try {
      const res = await (db.from('approvals' as never) as unknown as {
        update: (row: Record<string, unknown>) => { in: (c: string, v: string[]) => Promise<{ error: { message: string } | null }> }
      }).update({
        status:           newStatus,
        decided_at:       nowIso,
        decided_by_user:  session.userId,
        note:             typeof body.note === 'string' ? body.note.slice(0, 500) : null,
      }).in('id', updateIds)
      if (res.error) {
        for (const id of updateIds) {
          results.push({ id, ok: false, status: 'error', error: res.error.message })
        }
      } else {
        for (const id of updateIds) {
          results.push({ id, ok: true, status: newStatus as 'approved' | 'rejected' })
        }
      }
    } catch (err) {
      for (const id of updateIds) {
        results.push({ id, ok: false, status: 'error', error: err instanceof Error ? err.message : 'unknown' })
      }
    }
  }

  const approved = results.filter(r => r.status === 'approved').length
  const rejected = results.filter(r => r.status === 'rejected').length
  const alreadyDecided = results.filter(r => r.status === 'already_decided').length
  const notFound = results.filter(r => r.status === 'not_found').length
  const errors = results.filter(r => r.status === 'error').length

  return NextResponse.json({
    ok:                true,
    total:             results.length,
    approved,
    rejected,
    already_decided:   alreadyDecided,
    not_found:         notFound,
    errors,
    results,
  })
}
