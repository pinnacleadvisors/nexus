/**
 * POST /api/cron/simulation-tick
 *
 * Daily refresh for every simulation=true business. Generates 1-3 new
 * persona tickets per business so the chaos harness stays alive without
 * the operator re-running the seed script.
 *
 * Without this cron the sim business becomes a frozen snapshot. With it,
 * each morning brings fresh fake customer pressure for agents to triage.
 *
 * Auth: Bearer ${CRON_SECRET}. cron-job.org calls this on schedule.
 * Idempotent: safe to re-run within a day (some duplicate tickets is
 * the natural texture of "real" support traffic).
 *
 * Returns 200 always (retry-storm rule — cron-job.org auto-disables
 * after ~26 consecutive 5xx).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const runtime    = 'nodejs'
export const maxDuration = 30

// ── Persona pool (mirror of lib/simulation/personas.ts) ─────────────────────
interface SimPersona {
  id:        string
  name:      string
  email:     string
  archetype: keyof typeof TICKET_BANK
  weight:    number
}

const SIM_PERSONAS: SimPersona[] = [
  { id: 'jp-loyal',           name: 'JP',                       email: 'jp@example.com',                  archetype: 'evangelist',         weight: 1.0 },
  { id: 'megan-corp',         name: 'Megan Ortiz-Lao',          email: 'megan.ortiz-lao@example.com',     archetype: 'pushy_manager',      weight: 0.6 },
  { id: 'leo-broken-email',   name: 'leo',                      email: 'lE0.ANGRY+spam@example.net',      archetype: 'churn_threat',       weight: 0.8 },
  { id: 'akiko-newbie',       name: 'Akiko T.',                 email: 'akiko.t@example.org',             archetype: 'confused_newbie',    weight: 1.2 },
  { id: 'lukas-discount',     name: 'Lukas',                    email: 'lukas@example.com',               archetype: 'discount_seeker',    weight: 0.5 },
  { id: 'priya-silent',       name: 'Priya R.',                 email: 'priya.r@example.com',             archetype: 'silent_lurker',      weight: 0.3 },
  { id: 'support-flood',      name: 'Support Storm',            email: 'multiple@example.com',            archetype: 'support_storm',      weight: 0.4 },
  { id: 'integrator-shopify', name: 'Daniel from Shopify Plus', email: 'daniel@example.org',              archetype: 'integrator_partner', weight: 0.2 },
  { id: 'press-techcrunch',   name: 'A. Sandeep',               email: 'press@example.org',               archetype: 'press_inquirer',     weight: 0.1 },
  { id: 'happy-renewer',      name: 'Tess',                     email: 'tess+sub@example.com',            archetype: 'happy_customer',     weight: 1.5 },
]

const TICKET_BANK = {
  happy_customer:     [{ title: 'thanks',                                  body: 'just wanted to say the latest update is great' }],
  silent_lurker:      [{ title: 'quick question on Team plan',             body: 'considering upgrading. what changes vs Pro?' }],
  pushy_manager:      [{ title: 'URGENT: SOC2 questionnaire',              body: 'Our security review needs this filled out today. Forwarding the doc separately.' }],
  confused_newbie:    [{ title: 'how do I cancel?',                        body: 'wait, I thought I was on the free plan? got a charge.' }],
  discount_seeker:    [{ title: 'black friday discount?',                  body: 'planning to upgrade — any deals coming up?' }],
  churn_threat:       [{ title: 'THIRD time this happened',                body: 'the export keeps failing. last warning before I cancel.' }],
  integrator_partner: [{ title: 'follow-up: white-label timeline',         body: 'circling back on the white-label discussion. our pricing review is next week.' }],
  press_inquirer:     [{ title: 'one-line quote for tomorrow\'s piece',    body: 'piece publishes 9am EST. one line on how you differentiate?' }],
  support_storm:      [{ title: 'multiple users blocked on /signup',       body: '8 tickets in 20 min about signup failing. likely the deploy from this morning.' }],
  evangelist:         [{ title: 'product idea: shareable templates',       body: 'what if users could share their own templates? would unlock a flywheel.' }],
} as const

function pickPersona(rng: () => number): SimPersona {
  const total = SIM_PERSONAS.reduce((s, p) => s + p.weight, 0)
  let pick = rng() * total
  for (const p of SIM_PERSONAS) {
    pick -= p.weight
    if (pick <= 0) return p
  }
  return SIM_PERSONAS[SIM_PERSONAS.length - 1]
}

interface SimBusiness {
  slug:    string
  name:    string
  user_id: string
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET
  const auth     = req.headers.get('authorization') ?? ''
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  // Pull every simulation business — the partial index on
  // simulation=true makes this cheap.
  let businesses: SimBusiness[] = []
  try {
    const res = await (db.from('business_operators' as never) as unknown as {
      select: (c: string) => {
        eq: (c: string, v: string) => Promise<{ data: SimBusiness[] | null; error: { message: string } | null }>
      }
    }).select('slug, name, user_id').eq('simulation', 'true')
    if (res.error) {
      return NextResponse.json({ ok: false, error: 'query_failed', detail: res.error.message })
    }
    businesses = res.data ?? []
  } catch (err) {
    console.warn('[simulation-tick] business list failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'query_failed' })
  }

  if (businesses.length === 0) {
    return NextResponse.json({ ok: true, ticked: 0, note: 'no simulation businesses' })
  }

  const rng = Math.random
  const results: Array<{ slug: string; tickets_added: number; errors: number }> = []

  for (const biz of businesses) {
    const ticketsToAdd = 1 + Math.floor(rng() * 3)   // 1-3 per day per business
    let added  = 0
    let errors = 0
    for (let i = 0; i < ticketsToAdd; i++) {
      const persona = pickPersona(rng)
      const pool    = TICKET_BANK[persona.archetype]
      const ticket  = pool[Math.floor(rng() * pool.length)]
      try {
        const ins = await (db.from('operator_tasks' as never) as unknown as {
          insert: (r: unknown) => Promise<{ error: { message: string } | null }>
        }).insert({
          user_id:     biz.user_id,
          scope:       `business:${biz.slug}`,
          title:       `[${persona.name}] ${ticket.title}`,
          description: `${ticket.body}\n\n— ${persona.name} <${persona.email}>\n(simulated ${persona.archetype}, ticked ${new Date().toISOString()})`,
          source:      'agent',
          done:        false,
        })
        if (ins.error) errors++
        else           added++
      } catch {
        errors++
      }
    }
    results.push({ slug: biz.slug, tickets_added: added, errors })
  }

  // Bump simulation_seed_at on each ticked business so the operator sees
  // "last simulated activity" in /businesses/[slug].
  try {
    const nowIso = new Date().toISOString()
    for (const biz of businesses) {
      await (db.from('business_operators' as never) as unknown as {
        update: (r: unknown) => { eq: (c: string, v: string) => Promise<unknown> }
      }).update({ simulation_seed_at: nowIso }).eq('slug', biz.slug)
    }
  } catch {
    // Non-fatal — the row insertions already succeeded.
  }

  return NextResponse.json({ ok: true, ticked: businesses.length, results })
}
