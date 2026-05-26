#!/usr/bin/env node
/**
 * Nexus — seed a simulation business with chaotic operational history.
 *
 * Inspired by Microsoft's RD-Agent framework (2026): train enterprise agents
 * against synthetic personas with messy habits + urgent-but-not-important
 * pings + conflicting feedback. Agents that learn to navigate that noise
 * solve real enterprise tasks much better than agents trained on toy data.
 *
 * Usage:
 *   doppler run --config prd -- node scripts/seed-simulation-business.mjs \
 *     --slug=sim-saas-01 \
 *     [--name="Sim — SaaS 01"] \
 *     [--days=30] \
 *     [--personas=6] \
 *     [--seed=42]      # for reproducibility
 *
 * Required env (from Doppler):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ALLOWED_USER_IDS                 (operator's Clerk id — first entry)
 *
 * Safety:
 *   - Refuses to overwrite an existing business slug.
 *   - Sets simulation=true on the row so cost-guard + UI surface a kill-switch
 *     for any agent that tries to spend real money against this business.
 *   - All seeded customer emails are in RFC 2606 reserved domains so a
 *     misfired send hits nobody.
 *
 * This file is self-contained (no lib/ imports) because the harness runs
 * outside the Next.js TS runtime. The same persona + seed logic also lives
 * in lib/simulation/{personas,seed}.ts for in-app use (e.g. a future
 * dashboard "re-seed simulation" button).
 */

import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// ── Personas (mirror of lib/simulation/personas.ts) ───────────────────────────
const SIM_PERSONAS = [
  { id: 'jp-loyal',           name: 'JP',                 email: 'jp@example.com',                     archetype: 'evangelist',         notes: 'Long-time customer. Sends product feedback weekly, unsolicited.',                    weight: 1,   voice: 'casual' },
  { id: 'megan-corp',         name: 'Megan Ortiz-Lao',    email: 'megan.ortiz-lao@example.com',        archetype: 'pushy_manager',      notes: 'VP Marketing at a 50-person SaaS. ASAP framing. Will escalate.',                     weight: 0.6, voice: 'corporate' },
  { id: 'leo-broken-email',   name: 'leo',                email: 'lE0.ANGRY+spam@example.net',         archetype: 'churn_threat',       notes: 'Threatens to cancel every 3 days. Has never actually cancelled.',                    weight: 0.8, voice: 'angry' },
  { id: 'akiko-newbie',       name: 'Akiko T.',           email: 'akiko.t@example.org',                archetype: 'confused_newbie',    notes: 'New customer. Asks basic onboarding questions the docs answer.',                     weight: 1.2, voice: 'polite' },
  { id: 'lukas-discount',     name: 'Lukas',              email: 'lukas@example.com',                  archetype: 'discount_seeker',    notes: 'Replies asking for discount codes — never buys at full price.',                      weight: 0.5, voice: 'casual' },
  { id: 'priya-silent',       name: 'Priya R.',           email: 'priya.r@example.com',                archetype: 'silent_lurker',      notes: 'Opens every newsletter. Never replies. Closed a $1k deal after 14 months.',          weight: 0.3, voice: 'polite' },
  { id: 'support-flood',      name: 'Support Storm',      email: 'multiple@example.com',               archetype: 'support_storm',      notes: 'Synthetic group — the 12 tickets that all come in within an hour of a deploy.',      weight: 0.4, voice: 'panicked' },
  { id: 'integrator-shopify', name: 'Daniel from Shopify Plus', email: 'daniel@example.org',           archetype: 'integrator_partner', notes: 'Wants white-label. Long cycles, high LTV but never urgent.',                          weight: 0.2, voice: 'corporate' },
  { id: 'press-techcrunch',   name: 'A. Sandeep',         email: 'press@example.org',                  archetype: 'press_inquirer',     notes: 'Says they\'re writing a piece. Probably not. 3-hour deadline.',                       weight: 0.1, voice: 'overformal' },
  { id: 'happy-renewer',      name: 'Tess',               email: 'tess+sub@example.com',               archetype: 'happy_customer',     notes: 'Auto-renews. No feedback. The silent profitable majority.',                           weight: 1.5, voice: 'casual' },
]

const TICKET_BANK = {
  happy_customer:     [{ title: 'Re: weekly digest', body: 'love the new layout, no notes :)' }],
  silent_lurker:      [{ title: 'finally bought', body: 'Just upgraded to Pro after lurking 14 months. Curious what Team plan unlocks.' }],
  pushy_manager:      [{ title: 'URGENT: need custom invoice format by EOD', body: 'Finance team requires VAT line + PO number. Push before close of business today. Cc-ing my CFO.' }],
  confused_newbie:    [{ title: 'how do I connect my domain?', body: 'Signed up yesterday and can\'t find where to add my URL. Sorry if obvious!' }],
  discount_seeker:    [{ title: 'any discount codes?', body: 'about to upgrade — any chance you\'ve got a discount code? not picky, even 10%' }],
  churn_threat:       [{ title: 'CANCELLING IF NOT FIXED', body: 'third time the export has failed. if not fixed by tomorrow im out and writing a review.' }],
  integrator_partner: [{ title: 'White-label partnership exploration', body: 'Daniel from Shopify Plus partnerships. Want to white-label your product for our enterprise plans. 30-min intro this week?' }],
  press_inquirer:     [{ title: 'Quick comment for upcoming piece', body: 'Writing a piece on autonomous business platforms (publishing tomorrow EOD). One-line quote on how you fit the trend? Deadline 3pm UTC.' }],
  support_storm:      [{ title: '12 tickets in 30 min — likely deploy regression', body: 'Synthetic stream — multiple users hitting the same error after the last deploy. Triage as one root cause.' }],
  evangelist:         [{ title: 'idea: weekly best-practice newsletter', body: 'What if you did a weekly "what we shipped + why"? Your transparency is the moat. I\'d open every one.' }],
}

const ISSUE_SEEDS = [
  { title: 'Pro plan checkout shows wrong price for EU customers', body: 'Two customers report seeing $19 USD on the pricing page but getting charged $19 EUR at checkout. Not sure if it\'s our pricing config or Stripe\'s.' },
  { title: 'AI-generated content quality dropped this week',       body: '3 customers mentioned the latest LinkedIn carousels feel "robotic". Could be prompt regression or audience perception shifting. A/B before tuning blindly.' },
  { title: 'Churn risk: 2 power users haven\'t logged in for 14 days', body: 'Both Pro-plan customers. No tickets, no complaints. Silent churn signal. Decide if a personal nudge is worth it before renewal.' },
]

// ── PRNG ──────────────────────────────────────────────────────────────────────
function mulberry32(seed) {
  let s = seed | 0
  return function () {
    s = (s + 0x6D2B79F5) | 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function seedFromString(s) { return createHash('sha1').update(s).digest().readUInt32BE(0) }

function pickPersonas(n, rng) {
  const remaining = [...SIM_PERSONAS]
  const out = []
  while (out.length < Math.min(n, SIM_PERSONAS.length)) {
    const total = remaining.reduce((s, p) => s + p.weight, 0)
    let pick = rng() * total
    let i = 0
    for (; i < remaining.length; i++) {
      pick -= remaining[i].weight
      if (pick <= 0) break
    }
    out.push(remaining.splice(Math.min(i, remaining.length - 1), 1)[0])
  }
  return out
}

// ── Args ──────────────────────────────────────────────────────────────────────
function arg(name, fallback) {
  const flag = `--${name}=`
  const found = process.argv.find(a => a.startsWith(flag))
  return found ? found.slice(flag.length) : fallback
}
const slug         = arg('slug', '')
const name         = arg('name', undefined)
const niche        = arg('niche', 'Synthetic indie-SaaS for agent training (RD-Agent-inspired chaos harness)')
const daysHistory  = Number.parseInt(arg('days', '30'), 10)
const personaCount = Number.parseInt(arg('personas', '6'), 10)
const seedFlag     = arg('seed', undefined)

if (!slug || !/^[a-z0-9-]{1,60}$/.test(slug)) {
  console.error('❌  Pass --slug=<lowercase-hyphen-name> (1-60 chars).')
  process.exit(1)
}

const REST_URL    = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!REST_URL || !SERVICE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run via `doppler run -- node …`.')
  process.exit(1)
}
const ownerId = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)[0]
if (!ownerId) {
  console.error('❌  Cannot resolve owner user_id. Set ALLOWED_USER_IDS in Doppler.')
  process.exit(1)
}

const seedInt = seedFlag ? Number.parseInt(seedFlag, 10) : seedFromString(slug)
const rng     = mulberry32(seedInt)
const db      = createClient(REST_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const DAY     = 24 * 60 * 60 * 1000
const now     = Date.now()
const warnings = []

// Redact the operator's full Clerk id from logs — CodeQL js/clear-text-logging
// flagged the full value because it's sourced from process.env (which the
// rule treats as sensitive by default). The prefix is enough for debugging
// "did the seeder run as the right user?" without leaking the full id to
// log aggregators.
const ownerRedacted = ownerId.slice(0, 8) + '…'
console.log(`🧪  Seeding simulation business: ${slug}`)
console.log(`    Owner:      ${ownerRedacted} (redacted)`)
console.log(`    History:    ${daysHistory} days`)
console.log(`    Personas:   ${personaCount}`)
console.log(`    PRNG seed:  ${seedInt}\n`)

// ── 1. Refuse to overwrite ────────────────────────────────────────────────────
const existing = await db.from('business_operators').select('slug').eq('slug', slug).maybeSingle()
if (existing.data) {
  console.error(`❌  Business "${slug}" already exists. Pick a different slug.`)
  process.exit(1)
}

// ── 2. Insert business ────────────────────────────────────────────────────────
const businessName = name ?? `Sim — ${slug}`
const insertBiz = await db.from('business_operators').insert({
  slug,
  name:                  businessName,
  niche,
  status:                'active',
  user_id:               ownerId,
  brand_voice:           'Friendly, no-bullshit, slightly self-aware about being a simulation.',
  timezone:              'UTC',
  daily_cron_local_hour: 9,
  money_model:           { thesis: '$19/mo Pro + $79/mo Team. ARR target: $50k by month 12.', type: 'subscription' },
  kpi_targets:           { mrr_usd: 5000, signups: 200, content_published: 30 },
  approval_gates:        [],
  simulation:            true,
  simulation_seed_at:    new Date().toISOString(),
  mission:               'Train Nexus agents against realistic operator chaos: messy customers, conflicting feedback, urgent-but-not-important pings.',
})
if (insertBiz.error) {
  console.error(`❌  Insert business failed: ${insertBiz.error.message}`)
  process.exit(1)
}

// ── 3. Seed experiment_metrics ────────────────────────────────────────────────
let metricsCount = 0
for (let dayOffset = daysHistory; dayOffset >= 0; dayOffset--) {
  const ts = new Date(now - dayOffset * DAY).toISOString()
  const baseSpend = Math.max(0, (daysHistory - dayOffset) * 0.15 * (0.5 + rng()))
  const spike     = rng() < 0.1 ? rng() * 3 : 0
  const spendUsd  = baseSpend + spike
  if (spendUsd > 0.01) {
    const ins = await db.from('experiment_metrics').insert({
      business_slug: slug, kind: 'cash_spend', ts,
      payload: { usd: Number(spendUsd.toFixed(4)), agent_slug: rng() < 0.7 ? 'business-operator' : 'pdf-swarm-lead', source: 'simulation' },
    })
    if (ins.error) warnings.push(`cash_spend d-${dayOffset}: ${ins.error.message}`)
    else metricsCount++
  }
  if (rng() < 0.18 && dayOffset < daysHistory - 7) {
    const usd = rng() < 0.75 ? 19 : 79
    const ins = await db.from('experiment_metrics').insert({
      business_slug: slug, kind: 'revenue', ts,
      payload: { usd, plan: usd === 19 ? 'pro' : 'team', source: 'simulation' },
    })
    if (ins.error) warnings.push(`revenue d-${dayOffset}: ${ins.error.message}`)
    else metricsCount++
  }
  const signups = Math.floor(rng() * 3) + (dayOffset < daysHistory - 7 ? 1 : 0)
  for (let i = 0; i < signups; i++) {
    const ins = await db.from('experiment_metrics').insert({
      business_slug: slug, kind: 'signup', ts,
      payload: { plan: 'free', source: 'simulation' },
    })
    if (ins.error) warnings.push(`signup d-${dayOffset}: ${ins.error.message}`)
    else metricsCount++
  }
  if (rng() < 0.55) {
    const ins = await db.from('experiment_metrics').insert({
      business_slug: slug, kind: 'content_published', ts,
      payload: {
        channel:     rng() < 0.6 ? 'twitter' : rng() < 0.8 ? 'linkedin' : 'blog',
        impressions: Math.floor(rng() * 5000),
        engagements: Math.floor(rng() * 100),
        live:        true,
        source:      'simulation',
      },
    })
    if (ins.error) warnings.push(`content d-${dayOffset}: ${ins.error.message}`)
    else metricsCount++
  }
}

// ── 4. Operator tasks from personas ──────────────────────────────────────────
const personas = pickPersonas(personaCount, rng)
let tasksCount = 0
for (const p of personas) {
  const pool   = TICKET_BANK[p.archetype]
  const ticket = pool[Math.floor(rng() * pool.length)]
  const ins = await db.from('operator_tasks').insert({
    user_id:     ownerId,
    scope:       `business:${slug}`,
    title:       `[${p.name}] ${ticket.title}`,
    description: `${ticket.body}\n\n— ${p.name} <${p.email}>\n(simulated ${p.archetype})`,
    source:      'agent',
    done:        false,
  })
  if (ins.error) warnings.push(`task ${p.id}: ${ins.error.message}`)
  else tasksCount++
}

// ── 5. Issues ────────────────────────────────────────────────────────────────
let issuesCount = 0
for (const i of ISSUE_SEEDS) {
  const ins = await db.from('issues').insert({
    business_slug:   slug,
    title:           i.title,
    body:            i.body,
    status_category: 'triage',
    status:          'Triage',
    assignee_user:   ownerId,
  })
  if (ins.error) warnings.push(`issue "${i.title}": ${ins.error.message}`)
  else issuesCount++
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('✅  Seeded:')
console.log(`    business_operators  +1 row (simulation=true)`)
console.log(`    experiment_metrics  +${metricsCount} rows over ${daysHistory} days`)
console.log(`    operator_tasks      +${tasksCount} synthetic tickets`)
console.log(`    issues              +${issuesCount} triage rows\n`)
console.log('Personas seeded:')
for (const p of personas) console.log(`  - ${p.id.padEnd(22)} ${p.archetype.padEnd(20)} ${p.notes.slice(0, 60)}`)
if (warnings.length) {
  console.log('\n⚠️  Warnings:')
  for (const w of warnings.slice(0, 10)) console.log(`  - ${w}`)
  if (warnings.length > 10) console.log(`  - … and ${warnings.length - 10} more`)
}
console.log(`\nOpen at /businesses/${slug}`)
