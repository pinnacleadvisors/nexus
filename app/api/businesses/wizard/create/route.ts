/**
 * POST /api/businesses/wizard/create
 *
 * Wizard-driven business creation. Creates a SIMULATED business shell
 * (simulation=true) — no Coolify container, no DNS, no real-money mutations.
 * Operator graduates to production via POST /api/businesses/<slug>/graduate
 * once the pre-flight checklist on /businesses/<slug> goes green.
 *
 * Why simulation-first by default:
 *   - Lets operator iterate on niche / pricing / brand-voice without
 *     consuming production resources (Coolify container, Stripe metadata,
 *     Composio connections).
 *   - hyperbolic-chamber / simulation-tick generate fake customer pressure
 *     so the operator can see how agents respond before real customers arrive.
 *   - Graduation is one button, not a re-create.
 *
 * Body shape (every field optional except slug/name/niche):
 *   {
 *     slug:            string,                            // a-z0-9-, ≤ 60
 *     name:            string,
 *     niche:           string,                            // suggested by analyze-inspiration or operator-typed
 *     brand_voice:     string?,
 *     money_model:     'subscription'|'one_off'|'affiliate'|'ads'|'service'|'unknown',
 *     price_hint:      string?,                           // operator-confirmed entry-tier price
 *     audience:        string?,
 *     kpi_targets:     { mrr_90d?, signups_90d?, content_shipped_90d? },
 *     approval_gates:  string[],                          // gate slugs that need operator approval
 *     inspiration_url: string?,                           // recorded for provenance
 *     timezone:        string?,                           // default Asia/Bangkok (operator's)
 *   }
 *
 * Returns: { ok, slug, simulation:true, redirect:'/businesses/<slug>' }
 *
 * Retry-storm safe (200 always on transient failures).
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { upsertBusiness } from '@/lib/business/db'
import type { BusinessUpsert } from '@/lib/business/db'
import { setFixtureMode, getFixtureMode } from '@/lib/fixtures/store'

export const runtime = 'nodejs'
export const maxDuration = 30

interface WizardCreateBody {
  slug?:            unknown
  name?:            unknown
  niche?:           unknown
  brand_voice?:     unknown
  money_model?:     unknown
  price_hint?:      unknown
  audience?:        unknown
  kpi_targets?:     unknown
  approval_gates?:  unknown
  inspiration_url?: unknown
  timezone?:        unknown
}

const VALID_MONEY_MODELS = ['subscription', 'one_off', 'affiliate', 'ads', 'service', 'unknown'] as const
type MoneyModelKind = typeof VALID_MONEY_MODELS[number]

const DEFAULT_APPROVAL_GATES = [
  'real_money_movement',
  'customer_outreach',
  'public_publish',
  'destructive_infra',
]

/**
 * Niche-aware default KPI targets (90-day horizon). Used when the operator
 * leaves the KPI step blank in the wizard. Numbers are intentionally
 * conservative — graduate-preflight only needs SOMETHING non-empty so the
 * cost-guard's stagnation-pivot has a target to compare against. Operator
 * edits any time from /businesses/<slug>.
 *
 * Niche taxonomy mirrors the regex guess in analyze-inspiration:
 *   saas / info-products / e-commerce / service-agency / media-newsletter
 *   / creator-economy / general (fallback)
 */
function defaultKpisForNiche(niche: string): Record<string, number> {
  const n = niche.toLowerCase()
  if (/^saas|developer|api|platform/.test(n)) {
    return { mrr_90d: 1_000, signups_90d: 100, content_shipped_90d: 8 }
  }
  if (/^info-products|course|cohort|coaching/.test(n)) {
    return { units_sold_90d: 30, revenue_cents_90d: 90_000, content_shipped_90d: 12 }
  }
  if (/^e-commerce|shop|store/.test(n)) {
    return { orders_90d: 50, revenue_cents_90d: 150_000, returning_rate_pct_90d: 25 }
  }
  if (/^service-agency|consult|firm/.test(n)) {
    return { clients_90d: 5, revenue_cents_90d: 500_000, retainer_count_90d: 2 }
  }
  if (/^media|newsletter|blog/.test(n)) {
    return { subscribers_90d: 500, paid_subscribers_90d: 25, posts_shipped_90d: 24 }
  }
  if (/^creator|community|influencer/.test(n)) {
    return { followers_90d: 1_000, paid_supporters_90d: 20, posts_shipped_90d: 30 }
  }
  // Fallback — generic-but-non-empty
  return { signups_90d: 50, content_shipped_90d: 6 }
}

function isValidSlug(s: string): boolean { return /^[a-z0-9-]{1,60}$/.test(s) }

export async function POST(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 5, window: '1 m', prefix: 'biz-wizard:create' },
  })
  if ('response' in g) return g.response

  const body = await req.json().catch(() => ({})) as WizardCreateBody

  const slug  = typeof body.slug  === 'string' ? body.slug.trim().toLowerCase()  : ''
  const name  = typeof body.name  === 'string' ? body.name.trim()                : ''
  const niche = typeof body.niche === 'string' ? body.niche.trim().toLowerCase() : ''

  if (!isValidSlug(slug)) return NextResponse.json({ ok: false, error: 'invalid_slug', hint: 'a-z, 0-9, dash; max 60 chars' })
  if (!name)              return NextResponse.json({ ok: false, error: 'name_required' })
  if (!niche)             return NextResponse.json({ ok: false, error: 'niche_required' })

  // Reject collisions BEFORE upsert so the operator gets a friendly error
  // instead of a confusing "you don't own this row" later (upsert clobbers
  // by primary key but `upsertBusiness` ownership-checks first).
  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })
  try {
    const existing = await (db.from('business_operators' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { slug: string; user_id: string } | null }> } }
    }).select('slug,user_id').eq('slug', slug).maybeSingle()
    if (existing.data) {
      return NextResponse.json({
        ok: false,
        error: 'slug_taken',
        hint: existing.data.user_id === g.userId
          ? `You already own a business with slug "${slug}". Open /businesses/${slug} to edit it.`
          : `Slug "${slug}" is taken globally — pick a different one.`,
      })
    }
  } catch (err) {
    console.warn('[biz-wizard:create] slug-collision check failed:', err instanceof Error ? err.message : err)
  }

  // Narrow + sanitise the optional fields. Anything outside the enum
  // gets stripped server-side so the wizard can't pollute the row.
  const brandVoice     = typeof body.brand_voice  === 'string' ? body.brand_voice.trim().slice(0, 500)  : null
  const audience       = typeof body.audience     === 'string' ? body.audience.trim().slice(0, 500)     : null
  const priceHint      = typeof body.price_hint   === 'string' ? body.price_hint.trim().slice(0, 60)    : null
  const inspirationUrl = typeof body.inspiration_url === 'string' ? body.inspiration_url.trim().slice(0, 500) : null
  const timezone       = typeof body.timezone     === 'string' && body.timezone.trim() ? body.timezone.trim() : 'Asia/Bangkok'

  const moneyModelKind: MoneyModelKind = typeof body.money_model === 'string' && (VALID_MONEY_MODELS as readonly string[]).includes(body.money_model)
    ? body.money_model as MoneyModelKind
    : 'unknown'

  // Niche-aware default KPI targets — graduate preflight blocks on empty
  // kpi_targets, and forcing the operator to think about exact numbers up
  // front in the wizard kills momentum. Pre-fill conservative defaults
  // matched to the niche the operator picked (or that the inspiration URL
  // analysis suggested). Operator can edit any time from /businesses/<slug>.
  // J2 from session 2026-05-27 (companion to the wizard ship in PR #396).
  const operatorKpis = (body.kpi_targets && typeof body.kpi_targets === 'object' && body.kpi_targets !== null)
    ? body.kpi_targets as Record<string, unknown>
    : {}
  const kpiTargets = Object.keys(operatorKpis).length > 0
    ? operatorKpis
    : defaultKpisForNiche(niche)

  const approvalGates = Array.isArray(body.approval_gates) && body.approval_gates.every(g => typeof g === 'string')
    ? (body.approval_gates as string[]).slice(0, 16)
    : DEFAULT_APPROVAL_GATES

  const row: BusinessUpsert = {
    slug,
    name,
    status:                'active',
    user_id:               g.userId,
    brand_voice:           brandVoice,
    timezone,
    daily_cron_local_hour: 11,
    niche,
    money_model:           {
      kind:         moneyModelKind,
      entry_price:  priceHint,
      audience,
      inspiration:  inspirationUrl,
    } as unknown as BusinessUpsert['money_model'],
    kpi_targets:           kpiTargets as unknown as BusinessUpsert['kpi_targets'],
    approval_gates:        approvalGates as unknown as BusinessUpsert['approval_gates'],
    slack_channel:         null,
    slack_webhook_url:     null,
  }

  // First write — the business row itself.
  const saved = await upsertBusiness(row)
  if (!saved) return NextResponse.json({ ok: false, error: 'db_unavailable' })

  // Mark as simulation. We do this in a separate step rather than passing
  // it into upsertBusiness so the existing helper signature stays unchanged
  // (BusinessUpsert doesn't yet expose `simulation`). Idempotent + fail-soft.
  try {
    await (db.from('business_operators' as never) as unknown as {
      update: (r: unknown) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> }
    }).update({ simulation: true, simulation_seed_at: new Date().toISOString() }).eq('slug', slug)
  } catch (err) {
    console.warn('[biz-wizard:create] simulation-flag write failed (non-fatal):', err instanceof Error ? err.message : err)
  }

  // Auto-enable the dev fixture harness on FIRST simulation business so the
  // operator can immediately exercise chat / accounts / smoke / graduate
  // without OAuthing into real third-party platforms. Skipped if the
  // operator already has an explicit fixture-mode preference recorded —
  // we never override their stated choice.
  //
  // Detect "first-time" by querying current fixture mode: if it's already
  // ON (operator turned it on), no-op. If it's OFF, we still skip because
  // OFF could mean either "default" or "operator turned it off intentionally"
  // — and the latter is sacred. The signal we need is a row's presence,
  // which getFixtureMode collapses with absence. So we always-set-true
  // here only when the row does not yet exist. setFixtureMode currently
  // upserts unconditionally, so we check first via the cache-friendly read.
  let fixtureAutoEnabled = false
  try {
    const alreadyOn = await getFixtureMode(g.userId)
    if (!alreadyOn) {
      // Bound the harness to "on" only when no row exists OR the existing
      // row was set OFF without an operator-typed reason. The setFixtureMode
      // helper doesn't surface row provenance; for V1 we only auto-enable
      // when the read says OFF — keeps the wizard discoverable without
      // surprising operators who flipped fixture mode off on purpose.
      const out = await setFixtureMode(g.userId, true, 'auto-enabled by wizard on first simulation business')
      if (out.ok) fixtureAutoEnabled = true
    }
  } catch (err) {
    console.warn('[biz-wizard:create] fixture-mode auto-enable failed (non-fatal):', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({
    ok:         true,
    slug,
    simulation: true,
    fixture_mode_auto_enabled: fixtureAutoEnabled,
    redirect:   `/businesses/${encodeURIComponent(slug)}`,
    next_steps: [
      'Review the simulated business on /businesses/' + slug,
      fixtureAutoEnabled
        ? 'Fixture harness auto-enabled — /settings/accounts now shows synthetic platform rows you can use immediately. Disable at /settings → Access when ready for real OAuth.'
        : 'Run /api/businesses/<slug>/tick to see how agents respond to fake customer pressure',
      'When pre-flight checklist passes, POST /api/businesses/<slug>/graduate to flip simulation=false + provision real infra',
    ],
  })
}
