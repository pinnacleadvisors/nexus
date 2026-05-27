/**
 * GET  /api/businesses/[slug]/graduate — pre-flight checklist.
 * POST /api/businesses/[slug]/graduate — flip simulation=false (real-money mode).
 *
 * GET returns { ready, checks: [{ name, ok, hint }] } so the UI can render
 * the checklist before the operator confirms. POST refuses unless every
 * check passes (or `?force=1` is set — operator explicit override).
 *
 * The flip:
 *   - sets business_operators.simulation = false
 *   - logs to audit_log via lib/audit
 *   - returns the updated row
 *
 * After graduation, the existing cost-guard short-circuit (lib/simulation/
 * check.ts) stops returning Infinity for this business, so real spend caps
 * + money-moving-verb gates apply. The 60s simulation-flag cache means the
 * effect lands within ~1 minute (operator can wait or kick a tick).
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { audit } from '@/lib/audit'
import { isLeanMode } from '@/lib/lean-mode'
import { isConfigured as isCoolifyConfigured } from '@/lib/coolify/client'

export const runtime = 'nodejs'
// Allow up to 60s for the graduate POST when auto_provision fires — the
// downstream provision route creates a Coolify app (Docker pull, DNS
// reservation) which can take 30-45s on first deploy.
export const maxDuration = 60

interface RouteCtx { params: Promise<{ slug: string }> }

interface BusinessSnap {
  slug:        string
  simulation?: boolean | null
  kpi_targets: Record<string, unknown> | null
}

interface CheckResult {
  name: string
  ok:   boolean
  hint: string
}

async function buildPreflight(db: ReturnType<typeof createServerClient>, userId: string, slug: string): Promise<{ ready: boolean; checks: CheckResult[]; business: BusinessSnap | null }> {
  if (!db) return { ready: false, checks: [{ name: 'supabase', ok: false, hint: 'Supabase unconfigured.' }], business: null }

  const bizRes = await (db.from('business_operators' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: BusinessSnap | null }> } }
  }).select('slug, simulation, kpi_targets').eq('slug', slug).maybeSingle()
  const business = bizRes.data
  if (!business) {
    return { ready: false, checks: [{ name: 'business', ok: false, hint: 'Business not found.' }], business: null }
  }

  const checks: CheckResult[] = []

  // 1. Currently a simulation
  checks.push({
    name: 'currently_simulation',
    ok:   business.simulation === true,
    hint: business.simulation
      ? 'Business is currently flagged simulation=true (sane starting state).'
      : 'Business is ALREADY in real-money mode (simulation=false). Nothing to graduate.',
  })

  // 2. KPI targets are set (non-empty object)
  const kpiKeys = business.kpi_targets ? Object.keys(business.kpi_targets) : []
  checks.push({
    name: 'kpi_targets_set',
    ok:   kpiKeys.length > 0,
    hint: kpiKeys.length > 0
      ? `kpi_targets has ${kpiKeys.length} field${kpiKeys.length === 1 ? '' : 's'} (${kpiKeys.join(', ')}).`
      : 'kpi_targets is empty. The cost-guard stagnation pivot uses these to decide kill-switch. Set revenue_cents / signups / profit_cents before graduating.',
  })

  // 3. At least one connected account scoped to this business (or user-default)
  try {
    const connRes = await (db.from('connected_accounts' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ data: Array<{ platform: string }> | null }> } }
    }).select('platform').eq('user_id', userId).eq('business_slug', slug)
    const platforms = (connRes.data ?? []).map(r => r.platform)
    checks.push({
      name: 'connected_accounts',
      ok:   platforms.length > 0,
      hint: platforms.length > 0
        ? `${platforms.length} platform${platforms.length === 1 ? '' : 's'} connected for this business: ${platforms.join(', ')}.`
        : 'No connected accounts for this business slug. Connect at least one (Stripe / Gmail / Slack / etc.) from /settings/accounts so real dispatches have somewhere to land.',
    })
  } catch {
    checks.push({ name: 'connected_accounts', ok: false, hint: 'Could not query connected_accounts.' })
  }

  // 4. At least one finished simulation run — proves the business worked in sim
  try {
    const runRes = await (db.from('simulation_runs' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { limit: (n: number) => Promise<{ data: Array<{ id: string; result: Record<string, unknown> | null }> | null }> } } }
    }).select('id, result').eq('business_slug', slug).eq('status', 'done').limit(5)
    const runs = runRes.data ?? []
    checks.push({
      name: 'simulation_history',
      ok:   runs.length > 0,
      hint: runs.length > 0
        ? `${runs.length} completed sim run${runs.length === 1 ? '' : 's'} on file. The chaos harness already exercised this business's flow.`
        : 'No completed simulation runs yet. Run the hyperbolic chamber at least once first to confirm the basic flow works before exposing real money.',
    })
  } catch {
    checks.push({ name: 'simulation_history', ok: false, hint: 'Could not query simulation_runs.' })
  }

  // 5. Stripe configured (env var OR connected account)
  const stripeKey = process.env.STRIPE_SECRET_KEY
  const stripeConnected = await (async () => {
    try {
      const r = await (db.from('connected_accounts' as never) as unknown as {
        select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ data: Array<{ platform: string }> | null }> } }
      }).select('platform').eq('user_id', userId).eq('platform', 'stripe')
      return (r.data ?? []).length > 0
    } catch { return false }
  })()
  checks.push({
    name: 'stripe_configured',
    ok:   Boolean(stripeKey) || stripeConnected,
    hint: (stripeKey || stripeConnected)
      ? 'Stripe is reachable (env key OR connected account).'
      : 'Stripe is unreachable. Money-moving verbs will refuse without it. Set STRIPE_SECRET_KEY in Doppler OR connect Stripe via /settings/accounts (shared org pattern — tag transactions with metadata.business_slug).',
  })

  const ready = checks.every(c => c.ok)
  return { ready, checks, business }
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 30, window: '1 m', prefix: 'biz:grad:preflight' },
  })
  if ('response' in g) return g.response

  const { slug } = await ctx.params
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid_slug' })
  }

  const db  = createServerClient()
  const out = await buildPreflight(db, g.userId, slug)
  return NextResponse.json({ ok: true, ...out })
}

/**
 * Resolve the canonical internal base URL for server-to-server calls.
 * Mirrors the helper in /api/businesses/[slug]/tick — Doppler-set env over
 * a header-derived value (satisfies CodeQL js/request-forgery).
 */
function resolveInternalBaseUrl(): string {
  const env = process.env.NEXUS_BASE_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
  return `http://localhost:${process.env.PORT?.trim() || '3000'}`
}

interface GraduateBody {
  /** Default `true` when not in lean mode + Coolify is configured. Operator
   *  can pass `false` from GraduateModal to flip simulation without spinning
   *  up the Coolify container (e.g. operator wants to provision later via
   *  a separate POST). */
  auto_provision?: boolean
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 5, window: '1 m', prefix: 'biz:grad:flip' },
  })
  if ('response' in g) return g.response

  const { slug } = await ctx.params
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid_slug' })
  }
  const url   = new URL(req.url)
  const force = url.searchParams.get('force') === '1'

  // Body is optional — Vercel cron / scripts may POST with no body.
  let body: GraduateBody = {}
  try { body = (await req.json()) as GraduateBody } catch { /* empty body ok */ }

  // auto_provision defaults: true UNLESS the body explicitly says false,
  // OR lean-mode is active (lean mode skips per-business containers — the
  // graduated business runs against the shared gateway), OR Coolify isn't
  // configured server-side (no infra to spin up).
  const wantsAutoProvision = body.auto_provision !== false
  const canAutoProvision   = !isLeanMode() && isCoolifyConfigured()
  const willAutoProvision  = wantsAutoProvision && canAutoProvision

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const preflight = await buildPreflight(db, g.userId, slug)
  if (!preflight.business) {
    return NextResponse.json({ ok: false, error: 'business_not_found' })
  }
  if (!preflight.ready && !force) {
    return NextResponse.json({ ok: false, error: 'preflight_failed', preflight })
  }

  // Already graduated — idempotent return. If auto_provision was requested,
  // still fire the provision call below so the operator can use this
  // endpoint to re-provision an already-graduated business.
  const alreadyGraduated = preflight.business.simulation === false

  if (!alreadyGraduated) {
    const upd = await (db.from('business_operators' as never) as unknown as {
      update: (r: unknown) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> }
    }).update({ simulation: false, simulation_graduated_at: new Date().toISOString() }).eq('slug', slug)
    if (upd.error) return NextResponse.json({ ok: false, error: upd.error.message })

    // R4 follow-up: fire-and-forget operator notification on a successful
    // simulation → real-money graduation. Use Promise.allSettled so any
    // channel failure (Slack down, no web-push subscription, etc.) never
    // blocks the response. We import lazily to keep the route's hot path
    // small. Errors are swallowed — the audit row above is the durable
    // record; the notification is best-effort UX.
    void (async () => {
      try {
        const [{ listOperatorUserIds }, { notifyOperator }] = await Promise.all([
          import('@/lib/notifications/operators'),
          import('@/lib/notifications/dispatch'),
        ])
        const operatorIds = listOperatorUserIds()
        if (operatorIds.length === 0) return
        await Promise.all(operatorIds.map(userId =>
          notifyOperator(userId, 'graduation', {
            title:         `Graduated to real money: ${slug}`,
            body:          force
                             ? `Forced graduation (preflight overridden by operator)`
                             : `Preflight green; simulation flag flipped off`,
            link_href:     `/businesses/${encodeURIComponent(slug)}`,
            severity:      'info',
            business_slug: slug,
          }).catch(() => undefined),
        ))
      } catch { /* swallow */ }
    })()
  }

  audit(req, {
    action:     'business.graduate',
    resource:   'business',
    resourceId: slug,
    metadata:   {
      forced:          force,
      checks:          preflight.checks.map(c => ({ name: c.name, ok: c.ok })),
      auto_provision:  willAutoProvision,
      already_graduated: alreadyGraduated,
    },
  })

  // ── Auto-provision chain (operator's "automate setting up docker in
  // ── coolify" ask from session 2026-05-27). After flipping simulation,
  // ── fire the existing per-business provision route inline so the chain
  // ── completes in one POST. Failures are surfaced as a `provision` field
  // ── on the response — the graduate itself still succeeded. Operator can
  // ── retry provision via the standalone endpoint without re-graduating.
  let provisionResult: {
    ok:      boolean
    skipped: 'lean_mode' | 'coolify_unconfigured' | 'opted_out' | null
    uuid?:   string
    fqdn?:   string
    error?:  string
    detail?: string
  } = { ok: false, skipped: null }

  if (!wantsAutoProvision) {
    provisionResult = { ok: false, skipped: 'opted_out' }
  } else if (isLeanMode()) {
    provisionResult = { ok: false, skipped: 'lean_mode' }
  } else if (!isCoolifyConfigured()) {
    provisionResult = { ok: false, skipped: 'coolify_unconfigured' }
  } else {
    try {
      const provUrl = `${resolveInternalBaseUrl()}/api/businesses/${encodeURIComponent(slug)}/provision`
      const provRes = await fetch(provUrl, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie:         req.headers.get('cookie') ?? '',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(50_000),
      })
      const provBody = await provRes.json().catch(() => ({})) as {
        ok?: boolean; uuid?: string; fqdn?: string; error?: string; detail?: string
      }
      provisionResult = {
        ok:      Boolean(provBody.ok),
        skipped: null,
        uuid:    provBody.uuid,
        fqdn:    provBody.fqdn,
        error:   provBody.ok ? undefined : (provBody.error ?? `provision_${provRes.status}`),
        detail:  provBody.detail,
      }
    } catch (err) {
      provisionResult = {
        ok:      false,
        skipped: null,
        error:   err instanceof Error ? err.message : 'provision_threw',
      }
    }
  }

  return NextResponse.json({
    ok:                true,
    graduated:         !alreadyGraduated,
    already_graduated: alreadyGraduated,
    forced:            force,
    provision:         provisionResult,
  })
}
