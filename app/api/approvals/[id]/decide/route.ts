/**
 * POST /api/approvals/[id]/decide
 *
 * Operator-only approval decision endpoint. Wires the /approvals UI
 * (components/approvals/ApprovalCard.tsx) to migration 050's `approvals`
 * table — flips a pending row to `approved` or `rejected`, stamps decided_at
 * + decided_by_user.
 *
 * Idempotency: a row that is already in a terminal state (approved/rejected/
 * cancelled) returns 200 with the existing decision. Lets the UI replay the
 * click without 4xx-ing.
 *
 * Retry-storm safe: returns **200 + {ok: false}** on transient errors so a
 * confused refresh loop doesn't 5xx.
 *
 * Auth: Clerk + ALLOWED_USER_IDS — same as /api/health/deep.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
  decision: 'approve' | 'reject'
  note?:    string
}

interface ApprovalRow {
  id:             string
  status:         string
  decided_at:     string | null
  decided_by_user: string | null
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session.userId) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  if (!isOwner(session.userId)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const rl = await rateLimit(req, {
    limit:      30,
    window:     '1 m',
    prefix:     'approvals:decide',
    identifier: session.userId,
  })
  if (!rl.success) return rateLimitResponse(rl)

  const { id } = await ctx.params
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  if (body.decision !== 'approve' && body.decision !== 'reject') {
    return NextResponse.json({ ok: false, error: 'invalid_decision' }, { status: 400 })
  }
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 2000)) {
    return NextResponse.json({ ok: false, error: 'invalid_note' }, { status: 400 })
  }

  const db = createServerClient()
  if (!db) {
    // Retry-storm rule: return 200 + ok:false on infra unreachability so the
    // UI can show a transient error without retrying forever.
    return NextResponse.json({ ok: false, error: 'database_unavailable' }, { status: 200 })
  }

  // Fetch first to check current state. Idempotency: terminal rows return
  // the existing decision unchanged.
  const fromAny = (db as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          maybeSingle: () => Promise<{ data: ApprovalRow | null; error: { message: string } | null }>
        }
      }
      update: (row: Partial<ApprovalRow> & Record<string, unknown>) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>
        }
      }
    }
  }).from('approvals')

  const current = await fromAny.select('id,status,decided_at,decided_by_user').eq('id', id).maybeSingle()
  if (current.error) {
    // Most common cause: migration 050 not applied. Return 200 so the UI can
    // surface a helpful message rather than retrying.
    return NextResponse.json(
      { ok: false, error: 'approvals_table_missing', detail: current.error.message },
      { status: 200 },
    )
  }
  if (!current.data) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  // Already-decided rows return their existing state — idempotent for retries.
  if (current.data.status !== 'pending') {
    return NextResponse.json(
      {
        ok:        true,
        idempotent: true,
        status:    current.data.status,
        decided_at: current.data.decided_at,
      },
      { status: 200 },
    )
  }

  const newStatus = body.decision === 'approve' ? 'approved' : 'rejected'
  const update = await fromAny.update({
    status:          newStatus,
    decided_at:      new Date().toISOString(),
    decided_by_user: session.userId,
    decision_note:   body.note ?? null,
  }).eq('id', id).eq('status', 'pending')

  if (update.error) {
    return NextResponse.json({ ok: false, error: 'update_failed', detail: update.error.message }, { status: 200 })
  }

  return NextResponse.json({ ok: true, status: newStatus, decided_at: new Date().toISOString() })
}
