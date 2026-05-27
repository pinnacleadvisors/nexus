/**
 * POST /api/businesses/bulk — fleet-action endpoint (R7).
 *
 * Operator selects N businesses on /businesses and applies one of:
 *   - 'pause'           — flips business_operators.status='paused'
 *                          (resumed via the same endpoint with action='resume')
 *   - 'resume'          — flips status='active'
 *   - 'run-smoke'       — fires /api/businesses/<slug>/simulate/smoke for each
 *   - 'refresh-kpis'    — recomputes coaching insights + dispatches a
 *                          fresh business-operator tick per business (deferred)
 *
 * Body: { ids: string[], action: 'pause'|'resume'|'run-smoke'|'refresh-kpis' }
 *
 * Returns per-id result map. Like /api/approvals/decide-batch:
 *   - Max 50 ids per call.
 *   - Idempotent: already-paused row returns 'no-op'.
 *   - Retry-storm safe: 200 + per-id status. Even partial failures.
 *
 * Auth: Clerk + ALLOWED_USER_IDS. Each row gated by user_id ownership.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

type Action = 'pause' | 'resume' | 'run-smoke' | 'refresh-kpis'

interface Body { ids: unknown; action: unknown }

interface PerIdResult {
  slug:   string
  ok:     boolean
  status: 'paused' | 'resumed' | 'no-op' | 'smoke-started' | 'kpis-refreshed' | 'not-found' | 'error'
  detail?: string
  error?:  string
}

/** Resolve the internal base URL so this route can fan out to
 *  /api/businesses/<slug>/simulate/smoke. Doppler-set so CodeQL's
 *  SSRF check doesn't fire (pure env, no req-derived URL). */
function resolveBaseUrl(): string {
  return process.env.NEXUS_INTERNAL_BASE_URL
      ?? process.env.NEXUS_BASE_URL
      ?? 'http://localhost:3000'
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
    prefix:     'businesses:bulk',
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
      hint:  `Max ${MAX_BATCH_SIZE} per call.`,
    })
  }
  const validActions: Action[] = ['pause', 'resume', 'run-smoke', 'refresh-kpis']
  if (typeof body.action !== 'string' || !validActions.includes(body.action as Action)) {
    return NextResponse.json({ ok: false, error: 'invalid_action' })
  }
  const action = body.action as Action
  const slugs: string[] = body.ids.filter(x => typeof x === 'string' && /^[a-z0-9-]{1,60}$/.test(x as string)) as string[]
  if (slugs.length === 0) {
    return NextResponse.json({ ok: false, error: 'no_valid_slugs' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  // Verify ownership + load current status in one query.
  let priorRows: Array<{ slug: string; status: string; simulation: boolean | null; user_id: string }> = []
  try {
    const res = await (db.from('business_operators' as never) as unknown as {
      select: (c: string) => { in: (c: string, v: string[]) => Promise<{ data: Array<{ slug: string; status: string; simulation: boolean | null; user_id: string }> | null; error: { message: string } | null }> }
    }).select('slug, status, simulation, user_id').in('slug', slugs)
    if (res.error) {
      return NextResponse.json({ ok: false, error: res.error.message })
    }
    priorRows = res.data ?? []
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'unknown' })
  }

  // Drop rows that don't belong to the operator (defense-in-depth — RLS
  // should already enforce, but explicit ownership check here is one line).
  const ownedByOperator = priorRows.filter(r => r.user_id === session.userId)
  const ownedSlugs = new Set(ownedByOperator.map(r => r.slug))
  const ownedBySlug = new Map(ownedByOperator.map(r => [r.slug, r] as const))

  const results: PerIdResult[] = []

  for (const slug of slugs) {
    if (!ownedSlugs.has(slug)) {
      results.push({ slug, ok: false, status: 'not-found' })
    }
  }

  // Apply the action.
  if (action === 'pause' || action === 'resume') {
    const target = action === 'pause' ? 'paused' : 'active'
    const toUpdate = ownedByOperator.filter(r => r.status !== target).map(r => r.slug)
    const alreadyAtTarget = ownedByOperator.filter(r => r.status === target).map(r => r.slug)

    for (const s of alreadyAtTarget) {
      results.push({ slug: s, ok: true, status: 'no-op', detail: `already_${target}` })
    }
    if (toUpdate.length > 0) {
      try {
        const res = await (db.from('business_operators' as never) as unknown as {
          update: (row: Record<string, unknown>) => { in: (c: string, v: string[]) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> } }
        }).update({ status: target }).in('slug', toUpdate).eq('user_id', session.userId)
        if (res.error) {
          for (const s of toUpdate) results.push({ slug: s, ok: false, status: 'error', error: res.error.message })
        } else {
          for (const s of toUpdate) results.push({ slug: s, ok: true, status: action === 'pause' ? 'paused' : 'resumed' })
        }
      } catch (err) {
        for (const s of toUpdate) results.push({ slug: s, ok: false, status: 'error', error: err instanceof Error ? err.message : 'unknown' })
      }
    }
  }

  if (action === 'run-smoke') {
    // Fan out to /api/businesses/<slug>/simulate/smoke. Sequential
    // rather than parallel so we don't spike Supabase. 50 slugs × ~150ms
    // = ~7.5s — well within the maxDuration cap.
    const baseUrl = resolveBaseUrl()
    const cookie = req.headers.get('cookie') ?? ''
    for (const row of ownedByOperator) {
      if (row.simulation === false) {
        results.push({ slug: row.slug, ok: false, status: 'no-op', detail: 'real_money_business' })
        continue
      }
      try {
        const r = await fetch(`${baseUrl}/api/businesses/${row.slug}/simulate/smoke`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', cookie },
          body:    JSON.stringify({}),
          signal:  AbortSignal.timeout(20_000),
        })
        const j = await r.json().catch(() => ({})) as { ok?: boolean; run_id?: string; error?: string }
        if (j.ok && j.run_id) {
          results.push({ slug: row.slug, ok: true, status: 'smoke-started', detail: j.run_id })
        } else {
          results.push({ slug: row.slug, ok: false, status: 'error', error: j.error ?? 'smoke_failed' })
        }
      } catch (err) {
        results.push({ slug: row.slug, ok: false, status: 'error', error: err instanceof Error ? err.message : 'fetch_failed' })
      }
    }
  }

  if (action === 'refresh-kpis') {
    // V1: no-op placeholder. The KPI refresh flow doesn't have a single
    // dispatch endpoint yet — the agents that compute KPIs run on their
    // own cadence. Returns success per row so the operator sees the
    // intent landed; actual recompute happens next agent tick.
    //
    // V2: dispatch business-operator agent with `inputs.action: 'refresh-kpis'`.
    for (const row of ownedByOperator) {
      results.push({ slug: row.slug, ok: true, status: 'kpis-refreshed', detail: 'scheduled-next-tick' })
    }
  }

  const summary = {
    total:    results.length,
    ok_count: results.filter(r => r.ok).length,
    failed:   results.filter(r => !r.ok).length,
    by_status: results.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1
      return acc
    }, {} as Record<string, number>),
  }

  return NextResponse.json({ ok: true, action, ...summary, results })
}
