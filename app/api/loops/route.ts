/**
 * /api/loops — Loops collection.
 *
 *   GET  → list every Loop the operator owns (+ iteration count / total cost
 *          / last activity rollup) for the /settings/loops list page.
 *   POST → create a Loop. Validates, inserts, returns the new id.
 *
 * Auth: operator only — Clerk session OR Bearer NEXUS_OPS_TOKEN
 * (authenticateOps). Both 200 + {ok:false} on transient failure / missing
 * migration (retry-storm rule — schedulers may call POST).
 *
 * The `loops` table is the SOLE source of truth for what may fire — creating
 * a row does NOT start it. The operator (or a scheduler) calls
 * POST /api/loops/[id]/start to kick the first iteration.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateOps } from '@/lib/auth/ops-auth'
import { createLoop, listLoops } from '@/lib/loops/store'
import { isLoopMode, isReviewModality, type LoopCreateInput } from '@/lib/loops/types'

export const runtime    = 'nodejs'
export const dynamic    = 'force-dynamic'

const AGENT_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/

export async function GET(req: NextRequest) {
  const a = await authenticateOps(req, {})
  if ('response' in a) return a.response

  const url = new URL(req.url)
  const businessSlug = url.searchParams.get('business_slug')
  const res = await listLoops(a.userId, businessSlug)
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error })
  return NextResponse.json({ ok: true, loops: res.loops })
}

export async function POST(req: NextRequest) {
  let body: Partial<LoopCreateInput> & { userId?: string } = {}
  try { body = (await req.json()) as typeof body } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' })
  }

  const a = await authenticateOps(req, { bodyUserId: body.userId })
  if ('response' in a) return a.response

  // ── Validate ────────────────────────────────────────────────────────────
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ ok: false, error: 'name required' })

  const agent = typeof body.delegated_agent_slug === 'string' ? body.delegated_agent_slug.trim() : ''
  if (!AGENT_SLUG_RE.test(agent)) {
    return NextResponse.json({ ok: false, error: 'delegated_agent_slug must be lowercase, hyphenated, ≤ 60 chars' })
  }

  if (body.mode !== undefined && !isLoopMode(body.mode)) {
    return NextResponse.json({ ok: false, error: 'mode must be iterate | synthesize' })
  }
  if (body.review_modality !== undefined && body.review_modality !== null && !isReviewModality(body.review_modality)) {
    return NextResponse.json({ ok: false, error: 'review_modality must be vision | audio | code | text' })
  }

  const numOrNull = (v: unknown): number | null => {
    if (v === undefined || v === null || v === '') return null
    const n = typeof v === 'number' ? v : parseFloat(String(v))
    return Number.isFinite(n) && n > 0 ? n : null
  }

  const input: LoopCreateInput = {
    name,
    business_slug:        typeof body.business_slug === 'string' && body.business_slug.trim() ? body.business_slug.trim() : null,
    north_star_md:        typeof body.north_star_md === 'string' ? body.north_star_md : '',
    end_outcome_md:       typeof body.end_outcome_md === 'string' ? body.end_outcome_md : '',
    delegated_agent_slug: agent,
    delegated_team_id:    typeof body.delegated_team_id === 'string' ? body.delegated_team_id : null,
    cost_cap_usd:         numOrNull(body.cost_cap_usd),
    iteration_cap:        numOrNull(body.iteration_cap),
    time_cap_hours:       numOrNull(body.time_cap_hours),
    approval_gates:       Array.isArray(body.approval_gates) ? body.approval_gates.filter((g): g is string => typeof g === 'string') : [],
    mode:                 body.mode ?? 'iterate',
    explorer_model:       typeof body.explorer_model === 'string' && body.explorer_model.trim() ? body.explorer_model.trim() : null,
    verifier_model:       typeof body.verifier_model === 'string' && body.verifier_model.trim() ? body.verifier_model.trim() : null,
    review_modality:      (body.review_modality as LoopCreateInput['review_modality']) ?? null,
  }

  const res = await createLoop(input, a.userId)
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error })
  return NextResponse.json({ ok: true, id: res.id })
}
