/**
 * POST /api/experiments/:slug/kill
 *
 * Manual kill switch for the experiment dashboard's [Stop experiment] button.
 *
 * Inserts a `kind=kill_switch_check` row into `experiment_metrics` with
 * `payload = { manual: true, reason: 'operator_kill', by: <userId> }`. The
 * solopreneur-tick cron checks the most-recent row of this kind on every
 * iteration: when it sees `manual:true` it skips dispatch for that slug
 * (a stronger check than the automatic budget/stagnation kill, since the
 * operator override should win regardless of metric state).
 *
 * Auth — same two-mode pattern used by /api/businesses/:slug/provision:
 *   1. Clerk session + ALLOWED_USER_IDS owner gate (interactive — the dashboard)
 *   2. Authorization: Bearer <NEXUS_OPS_TOKEN> (curl, scripts)
 *
 * Response 200:
 *   { ok: true, slug, killedBy: '<userId>', wroteRow: true }
 *
 * Errors are surfaced as JSON; the route never returns 5xx for client-side
 * problems — that would trigger retry storms from any tool calling it.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { authenticateOps } from '@/lib/auth/ops-auth'
import { createServerClient } from '@/lib/supabase'
import { isBusinessSlug } from '@/lib/claw/business-client'
import { audit } from '@/lib/audit'

export const runtime    = 'nodejs'
export const maxDuration = 15

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await context.params
  if (!isBusinessSlug(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid businessSlug' }, { status: 400 })
  }

  // Two-mode auth — Clerk session OR Bearer NEXUS_OPS_TOKEN.
  const a = await authenticateOps(req)
  if ('response' in a) return a.response

  const db = createServerClient()
  if (!db) {
    return NextResponse.json(
      { ok: false, error: 'supabase not configured' },
      { status: 503 },
    )
  }

  const payload = {
    manual: true,
    reason: 'operator_kill',
    by:     a.userId,
    mode:   a.mode,
    ts:     new Date().toISOString(),
  }

  // experiment_metrics is migration 034 — not in generated Supabase types yet,
  // so use the `as never` shim already employed by lib/cost-guard.ts and the
  // solopreneur-tick cron route.
  let wroteRow = true
  let writeError: string | null = null
  try {
    const insertResult = await (db.from('experiment_metrics' as never) as unknown as {
      insert: (rec: unknown) => Promise<{ error: { message: string } | null }>
    }).insert({
      business_slug: slug,
      kind:          'kill_switch_check',
      payload,
    })
    if (insertResult.error) {
      wroteRow = false
      writeError = insertResult.error.message
    }
  } catch (err) {
    wroteRow = false
    writeError = err instanceof Error ? err.message : String(err)
  }

  audit(req, {
    action:     'experiment.kill',
    resource:   'experiment',
    resourceId: slug,
    userId:     a.userId,
    metadata:   { mode: a.mode, wroteRow, error: writeError, principal: a.principal },
  })

  if (!wroteRow) {
    // Per retry-storm rule: surface the failure as 200 + ok:false rather than
    // 5xx so client retries don't multiply this already-side-effecting call.
    return NextResponse.json({
      ok:       false,
      slug,
      killedBy: a.userId,
      wroteRow: false,
      error:    writeError ?? 'unknown insert failure',
    })
  }

  return NextResponse.json({
    ok:       true,
    slug,
    killedBy: a.userId,
    wroteRow: true,
  })
}
