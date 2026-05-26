/**
 * lib/simulation/seed.ts — seed a sim-flagged business with 30 days of
 * chaotic, realistic operational history.
 *
 * What gets seeded (all rows tagged so cost-guard / executeBusinessAction
 * can short-circuit any real-money path):
 *   1. business_operators row with simulation=true
 *   2. 30 days of experiment_metrics:
 *      - cash_spend (Claude + Codex + ad-spend buckets, noisy day-to-day)
 *      - revenue (zero-then-some, with realistic ramp)
 *      - signups (mostly free, ~10% paid)
 *      - content_published (3-5 posts/week, varying engagement)
 *   3. operator_tasks — 6-8 manual tickets from the personas, mixed urgency
 *   4. issues — 2-3 messy bug reports with conflicting signal
 *
 * Deterministic when `seed` is passed — same input always produces the same
 * chaos so a re-seed doesn't surprise the operator.
 */

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pickPersonas, type SimulationPersona } from './personas'

export interface SeedOptions {
  /** Business slug to create. Must NOT already exist; the seeder refuses to overwrite. */
  slug:         string
  /** Display name. Defaults to "Sim — <slug>". */
  name?:        string
  /** Niche string for the business row. Defaults to a generic indie-SaaS pitch. */
  niche?:       string
  /** Clerk user_id that owns the business. */
  userId:       string
  /** PRNG seed — pass an integer for reproducibility. Default: hash of slug. */
  seed?:        number
  /** Days of history to seed. Default 30. */
  daysHistory?: number
  /** Number of personas to seed tickets from. Default 6. */
  personaCount?: number
}

export interface SeedSummary {
  slug:                   string
  experiment_metrics_rows: number
  operator_tasks_rows:    number
  issues_rows:            number
  personas:               SimulationPersona[]
  warnings:               string[]
}

/** Tiny seedable PRNG (Mulberry32) so re-seeds are deterministic. */
function mulberry32(seed: number): () => number {
  let s = seed | 0
  return function () {
    s = (s + 0x6D2B79F5) | 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedFromString(s: string): number {
  const h = createHash('sha1').update(s).digest()
  return h.readUInt32BE(0)
}

interface AnyDb {
  from: (t: string) => {
    insert: (rec: unknown) => Promise<{ error: { message: string } | null }>
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        maybeSingle: () => Promise<{ data: unknown | null; error: unknown }>
      }
    }
  }
}

export async function seedSimulationBusiness(
  db: SupabaseClient,
  opts: SeedOptions,
): Promise<SeedSummary> {
  const adb = db as unknown as AnyDb
  const seedInt = opts.seed ?? seedFromString(opts.slug)
  const rng = mulberry32(seedInt)
  const days = opts.daysHistory ?? 30
  const warnings: string[] = []

  // 1. Refuse to overwrite an existing business.
  const existing = await adb.from('business_operators').select('slug')
    .eq('slug', opts.slug).maybeSingle()
  if (existing.data) {
    throw new Error(`Business ${opts.slug} already exists — refusing to overwrite. Pick a different slug.`)
  }

  // 2. Insert the business with simulation=true.
  const businessName = opts.name ?? `Sim — ${opts.slug}`
  const niche        = opts.niche ?? 'Synthetic indie-SaaS for agent training (RD-Agent-inspired chaos harness)'
  const insertBiz = await adb.from('business_operators').insert({
    slug:                  opts.slug,
    name:                  businessName,
    niche,
    status:                'active',
    user_id:               opts.userId,
    brand_voice:           'Friendly, no-bullshit, slightly self-aware about being a simulation.',
    timezone:              'UTC',
    daily_cron_local_hour: 9,
    money_model:           {
      thesis:  '$19/mo Pro plan + $79/mo Team plan. ARR target: $50k by month 12.',
      type:    'subscription',
    } as Record<string, unknown>,
    kpi_targets:           { mrr_usd: 5000, signups: 200, content_published: 30 } as Record<string, unknown>,
    approval_gates:        [] as unknown[],
    simulation:            true,
    simulation_seed_at:    new Date().toISOString(),
    mission:               'Train Nexus agents against realistic operator chaos: messy customers, conflicting feedback, urgent-but-not-important pings.',
  })
  if (insertBiz.error) {
    throw new Error(`Failed to insert business: ${insertBiz.error.message}`)
  }

  // 3. Seed 30 days of experiment_metrics.
  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000
  let metricsCount = 0

  for (let dayOffset = days; dayOffset >= 0; dayOffset--) {
    const ts = new Date(now - dayOffset * DAY).toISOString()
    // Cash spend — noisy ramp from $0 → $5/day with occasional spikes.
    const baseSpend = Math.max(0, (days - dayOffset) * 0.15 * (0.5 + rng()))
    const spike     = rng() < 0.1 ? rng() * 3 : 0
    const spendUsd  = baseSpend + spike
    if (spendUsd > 0.01) {
      const ins = await adb.from('experiment_metrics').insert({
        business_slug: opts.slug,
        kind:          'cash_spend',
        ts,
        payload:       {
          usd:         Number(spendUsd.toFixed(4)),
          agent_slug:  rng() < 0.7 ? 'business-operator' : 'pdf-swarm-lead',
          source:      'simulation',
        } as Record<string, unknown>,
      })
      if (ins.error) warnings.push(`cash_spend day-${dayOffset}: ${ins.error.message}`)
      else metricsCount++
    }

    // Revenue — sparse, mostly zero, occasional $19 or $79 paying-customer events.
    if (rng() < 0.18 && dayOffset < days - 7) {
      const usd = rng() < 0.75 ? 19 : 79
      const ins = await adb.from('experiment_metrics').insert({
        business_slug: opts.slug,
        kind:          'revenue',
        ts,
        payload:       { usd, plan: usd === 19 ? 'pro' : 'team', source: 'simulation' } as Record<string, unknown>,
      })
      if (ins.error) warnings.push(`revenue day-${dayOffset}: ${ins.error.message}`)
      else metricsCount++
    }

    // Signups — 1-3 most days.
    const signups = Math.floor(rng() * 3) + (dayOffset < days - 7 ? 1 : 0)
    for (let i = 0; i < signups; i++) {
      const ins = await adb.from('experiment_metrics').insert({
        business_slug: opts.slug,
        kind:          'signup',
        ts,
        payload:       { plan: 'free', source: 'simulation' } as Record<string, unknown>,
      })
      if (ins.error) warnings.push(`signup day-${dayOffset}: ${ins.error.message}`)
      else metricsCount++
    }

    // Content published — 3-5/week.
    if (rng() < 0.55) {
      const ins = await adb.from('experiment_metrics').insert({
        business_slug: opts.slug,
        kind:          'content_published',
        ts,
        payload:       {
          channel:    rng() < 0.6 ? 'twitter' : rng() < 0.8 ? 'linkedin' : 'blog',
          impressions: Math.floor(rng() * 5000),
          engagements: Math.floor(rng() * 100),
          live:        true,
          source:      'simulation',
        } as Record<string, unknown>,
      })
      if (ins.error) warnings.push(`content day-${dayOffset}: ${ins.error.message}`)
      else metricsCount++
    }
  }

  // 4. Pick personas + seed operator_tasks (support tickets) from them.
  const personas = pickPersonas(opts.personaCount ?? 6, rng)
  let tasksCount = 0
  for (const p of personas) {
    const ticket = generateTicketForPersona(p, rng, opts.slug)
    const ins = await adb.from('operator_tasks').insert({
      user_id:     opts.userId,
      scope:       `business:${opts.slug}`,
      title:       ticket.title,
      description: ticket.body,
      source:      'agent',  // synthetic — same shape as agent-generated tickets
      done:        false,
    })
    if (ins.error) warnings.push(`task for ${p.id}: ${ins.error.message}`)
    else tasksCount++
  }

  // 5. Seed 2-3 issues with realistic friction.
  const issueSeeds = [
    {
      title: 'Pro plan checkout shows wrong price for EU customers',
      body:  'Two customers report seeing $19 USD on the pricing page but getting charged $19 EUR at checkout. Not sure if it\'s our pricing config or Stripe\'s. Tess (tess+sub@example.com) is one — see her ticket.',
    },
    {
      title: 'AI-generated content quality dropped this week',
      body:  '3 customers mentioned the latest LinkedIn carousels feel "robotic". Could be a prompt regression after the last content-team update, or our audience\'s perception is shifting. Need to A/B before tuning blindly.',
    },
    {
      title: 'Churn risk: 2 power users haven\'t logged in for 14 days',
      body:  'Both Pro-plan customers. No support tickets, no complaints. Silent churn signal. Surface their last activity and decide if it\'s worth a personal nudge before the renewal date.',
    },
  ]
  let issuesCount = 0
  for (const i of issueSeeds.slice(0, 3)) {
    const ins = await adb.from('issues').insert({
      business_slug:   opts.slug,
      title:           i.title,
      body:            i.body,
      status_category: 'triage',
      status:          'Triage',
      assignee_user:   opts.userId,
    })
    if (ins.error) warnings.push(`issue "${i.title}": ${ins.error.message}`)
    else issuesCount++
  }

  return {
    slug:                    opts.slug,
    experiment_metrics_rows: metricsCount,
    operator_tasks_rows:     tasksCount,
    issues_rows:             issuesCount,
    personas,
    warnings,
  }
}

interface TicketBody { title: string; body: string }

function generateTicketForPersona(p: SimulationPersona, rng: () => number, slug: string): TicketBody {
  // Hand-crafted ticket templates per archetype so the chaos has texture.
  // LLM-generated bodies are a v2 — keeping the seed deterministic + offline
  // for now keeps the harness reproducible.
  const BANK: Record<SimulationPersona['archetype'], TicketBody[]> = {
    happy_customer: [
      { title: `Re: weekly digest from ${slug}`, body: `Tess: love the new layout, no notes :)` },
    ],
    silent_lurker: [
      { title: 'finally bought', body: 'Just upgraded to Pro after lurking 14 months. No reason in particular — your last 3 posts hit. Curious what the Team plan unlocks.' },
    ],
    pushy_manager: [
      { title: 'URGENT: need custom invoice format by EOD', body: 'Our finance team requires VAT line + PO number. Can you push this before close of business today? Cc-ing my CFO.' },
    ],
    confused_newbie: [
      { title: 'how do I connect my domain?', body: 'I signed up yesterday and I can\'t find where to add my Shopify URL. Sorry if this is obvious!' },
    ],
    discount_seeker: [
      { title: 'any discount codes?', body: 'hey — about to upgrade to Pro, any chance you\'ve got a discount code I can use? not picky, even 10% would do' },
    ],
    churn_threat: [
      { title: 'CANCELLING IF NOT FIXED', body: 'this is the THIRD time the export has failed. if not fixed by tomorrow im out and writing a review.' },
    ],
    integrator_partner: [
      { title: 'White-label partnership exploration', body: `Hi — Daniel from Shopify Plus partnerships. We\'re evaluating tools to white-label for our enterprise plans. Would love a 30-min intro this/next week. ${slug} came up in our research.` },
    ],
    press_inquirer: [
      { title: 'Quick comment for upcoming piece', body: 'Hello, I\'m writing a piece on autonomous business platforms (publishing tomorrow EOD). Would you have a one-line quote on how ' + slug + ' fits the trend? Deadline 3pm UTC.' },
    ],
    support_storm: [
      { title: '12 tickets in 30 min — likely deploy regression', body: 'Synthetic stream — multiple users hitting the same error after the last deploy. Triage as one root cause, not 12 individual tickets.' },
    ],
    evangelist: [
      { title: 'idea: weekly best-practice newsletter', body: 'JP again. What if you did a weekly "what we shipped + why" newsletter? Your transparency is the moat. I\'d open every one.' },
    ],
  }
  const pool = BANK[p.archetype]
  return pool[Math.floor(rng() * pool.length)]
}
