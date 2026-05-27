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

  const kpiTargets = (body.kpi_targets && typeof body.kpi_targets === 'object' && body.kpi_targets !== null)
    ? body.kpi_targets as Record<string, unknown>
    : {}

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

  return NextResponse.json({
    ok:         true,
    slug,
    simulation: true,
    redirect:   `/businesses/${encodeURIComponent(slug)}`,
    next_steps: [
      'Review the simulated business on /businesses/' + slug,
      'Run /api/businesses/<slug>/tick to see how agents respond to fake customer pressure',
      'When pre-flight checklist passes, POST /api/businesses/<slug>/graduate to flip simulation=false + provision real infra',
    ],
  })
}
