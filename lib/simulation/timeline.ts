/**
 * lib/simulation/timeline.ts — Monte Carlo event generator for the
 * hyperbolic-chamber simulation (PR #364, task_plan-hyperbolic-chamber.md).
 *
 * Generates a deterministic, chronologically-sorted list of synthetic
 * events that exercise the agent stack: inbound tickets from the persona
 * pool, agent actions, approval gates, daily KPI snapshots, occasional
 * failures. Same seed → same timeline (replay-friendly).
 *
 * Used by the engine in two modes:
 *   - manual: engine processes one event per tick; UI shows current state
 *   - auto: engine runs straight through, auto-approver decides each gate
 *
 * No real money / no paid LLM is touched — the existing simulation
 * cost-guard (lib/simulation/check.ts → lib/cost-guard.ts) makes that
 * structural; this file just generates the script.
 */

import { SIM_PERSONAS } from './personas'

export type SimEventKind =
  | 'inbound_ticket'
  | 'agent_action'
  | 'approval_gate'
  | 'kpi_snapshot'
  | 'failure'
  | 'churn'

export interface SimEvent {
  sim_day:  number          // 0..(compress_days - 1)
  sim_hour: number          // 0.00..23.99
  kind:     SimEventKind
  payload:  Record<string, unknown>
}

export interface BusinessSnapshot {
  niche?:           string | null
  money_model?:     Record<string, unknown> | null
  kpi_targets?:     Record<string, unknown> | null
  approval_gates?:  string[] | null
}

// ── mulberry32 PRNG seeded from a string ─────────────────────────────────────
function makeRng(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let state = h >>> 0
  return function (): number {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Knuth's poisson sampler — fine for small lambda (≤ 10)
function poisson(rng: () => number, lambda: number): number {
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  // Cap iterations defensively in case lambda is misused
  for (let i = 0; i < 50; i++) {
    k++
    p *= rng()
    if (p <= L) return k - 1
  }
  return k - 1
}

// Per-archetype subject-line pool. The body is filled later by the
// voice generator (lib/simulation/persona-voice.ts) — template or LLM
// depending on the run's synthetic_voice setting.
const TICKET_TITLE_POOL: Record<string, string[]> = {
  happy_customer:     ['thanks 🙌', 'shoutout', 'one thing that worked great'],
  silent_lurker:      ['quick question on Team plan', 'curious about pricing', 'demo request'],
  pushy_manager:      ['URGENT: SOC2 questionnaire', 'need this before EOD', 'CEO wants context — pls reply'],
  confused_newbie:    ['how do I cancel?', 'got charged?? help', 'i thought i was on free'],
  discount_seeker:    ['black friday discount?', 'non-profit pricing?', 'annual vs monthly?'],
  churn_threat:       ['THIRD time this happened', 'last warning before I cancel', 'unhappy customer'],
  integrator_partner: ['follow-up: white-label timeline', 'partnership next steps', 'API quota increase'],
  press_inquirer:     ['one-line quote for tomorrow\'s piece', 'comment for our Q3 feature', 'background convo?'],
  support_storm:      ['multiple users blocked on /signup', '/checkout returning 500', 'site down??'],
  evangelist:         ['product idea: shareable templates', 'community demo idea', 'what if we let users…'],
}

const AGENT_POOL = [
  'business-operator',
  'engineering-lead',
  'content-lead',
  'sales-cs-lead',
  'operations-lead',
  'design-lead',
  'research-lead',
]

const ACTION_TITLES: Record<string, string[]> = {
  'business-operator':   ['weekly KPI review', 'pricing tier audit', 'cohort retention check'],
  'engineering-lead':    ['ship hot-fix for /api/checkout', 'reduce p95 latency on dashboard', 'address Sentry top-3'],
  'content-lead':        ['publish weekly blog', 'review LinkedIn engagement', 'edit YouTube short'],
  'sales-cs-lead':       ['follow up with cold leads', 'monthly QBR with top-5 accounts', 'kick off renewal cycle'],
  'operations-lead':     ['reconcile Stripe payouts', 'rotate Doppler service tokens', 'review infra health'],
  'design-lead':         ['critique onboarding flow', 'tweak mobile breakpoints', 'finalize Q3 brand palette'],
  'research-lead':       ['scrape competitor pricing', 'survey 5 customers', 'audit churn drivers'],
}

const DEFAULT_GATES = [
  'niche_pick',
  'kill_experiment',
  'outbound_campaign_start',
  'price_change',
  'pivot',
  'deploy_to_prod',
]

/**
 * Generate the full event timeline for a simulation run. Deterministic from
 * `seed`: two calls with identical args produce identical output.
 *
 * Per sim day:
 *   - ticket count: poisson(2), capped at 5
 *   - agent actions: 1..3 uniform
 *   - approval gates: 0..2 uniform
 *   - KPI snapshot: exactly 1 at 23:59
 *   - failure: 5% chance, severity {minor, critical} weighted 70/30
 */
export function generateTimeline(opts: {
  seed:          string
  compress_days: number
  business?:     BusinessSnapshot | null
}): SimEvent[] {
  const rng    = makeRng(opts.seed)
  const events: SimEvent[] = []
  const gates  = (opts.business?.approval_gates && opts.business.approval_gates.length > 0)
    ? opts.business.approval_gates
    : DEFAULT_GATES

  for (let day = 0; day < opts.compress_days; day++) {
    // Inbound tickets
    const ticketCount = Math.min(5, poisson(rng, 2))
    for (let t = 0; t < ticketCount; t++) {
      const persona  = SIM_PERSONAS[Math.floor(rng() * SIM_PERSONAS.length)]
      const titles   = TICKET_TITLE_POOL[persona.archetype] ?? TICKET_TITLE_POOL.happy_customer
      const title    = titles[Math.floor(rng() * titles.length)]
      // v3: each ticket gets a deterministic chain_id so follow-ups +
      // churn events link back. Same seed → same chain trees.
      const chainId    = `chain-${day}-${t}`
      const ticketHour = Number((rng() * 18 + 6).toFixed(2))
      events.push({
        sim_day:  day,
        sim_hour: ticketHour,
        kind:     'inbound_ticket',
        payload: {
          persona_id:    persona.id,
          persona_name:  persona.name,
          archetype:     persona.archetype,
          email:         persona.email,
          voice:         persona.voice,
          title,
          chain_id:      chainId,
          chain_step:    0,
        },
      })

      // v3 follow-up generation. 40% of tickets get a follow-up
      // 2-5 days later. press_inquirer + happy_customer skip (one-shot).
      // churn_threat that DON'T get a follow-up have a 50% churn event.
      const isOneAndDone = persona.archetype === 'press_inquirer' || persona.archetype === 'happy_customer'
      const willFollowUp = !isOneAndDone && rng() < 0.4
      const followUpDay  = day + 2 + Math.floor(rng() * 4)

      if (willFollowUp && followUpDay < opts.compress_days) {
        const followUpArchetype = (
          persona.archetype === 'pushy_manager'   ? 'churn_threat'   :
          persona.archetype === 'discount_seeker' ? 'silent_lurker'  :
          persona.archetype
        ) as typeof persona.archetype
        const fuTitles = TICKET_TITLE_POOL[followUpArchetype] ?? titles
        events.push({
          sim_day:  followUpDay,
          sim_hour: Number(((ticketHour + rng() * 4) % 24).toFixed(2)),
          kind:     'inbound_ticket',
          payload: {
            persona_id:          persona.id,
            persona_name:        persona.name,
            archetype:           followUpArchetype,
            email:                persona.email,
            voice:                persona.voice,
            title:                `re: ${fuTitles[Math.floor(rng() * fuTitles.length)]}`,
            chain_id:             chainId,
            chain_step:           1,
            in_response_to_day:   day,
            in_response_to_hour:  ticketHour,
          },
        })
      } else if (persona.archetype === 'churn_threat' && followUpDay < opts.compress_days && rng() < 0.5) {
        events.push({
          sim_day:  followUpDay,
          sim_hour: 23.5,
          kind:     'churn',
          payload: {
            persona_id:   persona.id,
            persona_name: persona.name,
            archetype:    persona.archetype,
            email:        persona.email,
            chain_id:     chainId,
            reason:       'no_response_to_threat',
            origin_day:   day,
          },
        })
      }
    }

    // Agent actions
    const actionCount = 1 + Math.floor(rng() * 3)
    for (let a = 0; a < actionCount; a++) {
      const agent = AGENT_POOL[Math.floor(rng() * AGENT_POOL.length)]
      const titles = ACTION_TITLES[agent] ?? ['execute next-action']
      events.push({
        sim_day:  day,
        sim_hour: Number((rng() * 16 + 8).toFixed(2)),
        kind:     'agent_action',
        payload: {
          agent,
          action_title: titles[Math.floor(rng() * titles.length)],
          tools_budget: ['Read', 'Grep', 'Edit'],
        },
      })
    }

    // Approval gates
    const gateCount = Math.floor(rng() * 3)
    for (let g = 0; g < gateCount; g++) {
      const gateKind = gates[Math.floor(rng() * gates.length)]
      events.push({
        sim_day:  day,
        sim_hour: Number((rng() * 12 + 10).toFixed(2)),
        kind:     'approval_gate',
        payload: {
          gate_kind:     gateKind,
          title:         `[${gateKind}] proposal day ${day}`,
          justification: rng() < 0.6
            ? 'KPI trend supports the change (synthetic).'
            : '',
          irreversible: ['niche_pick', 'kill_experiment', 'pivot'].includes(gateKind),
        },
      })
    }

    // EOD KPI snapshot
    events.push({
      sim_day:  day,
      sim_hour: 23.99,
      kind:     'kpi_snapshot',
      payload: {
        signups_today:        Math.floor(rng() * 30),
        revenue_today_cents:  Math.floor(rng() * 50_000),
        spend_today_cents:    200 + Math.floor(rng() * 2_000),
        active_customers:     50 + Math.floor(rng() * 200) + day * 2,
      },
    })

    // Rare failure
    if (rng() < 0.05) {
      events.push({
        sim_day:  day,
        sim_hour: Number((rng() * 24).toFixed(2)),
        kind:     'failure',
        payload: {
          source:   ['deploy', 'composio', 'stripe-webhook', 'cron'][Math.floor(rng() * 4)],
          severity: rng() < 0.3 ? 'critical' : 'minor',
          message:  'Synthetic failure injected by chaos harness.',
        },
      })
    }
  }

  events.sort((a, b) => (a.sim_day - b.sim_day) || (a.sim_hour - b.sim_hour))
  return events
}
