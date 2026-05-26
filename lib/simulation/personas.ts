/**
 * lib/simulation/personas.ts — chaotic, realistic customer personas for the
 * simulation harness.
 *
 * Inspired by Microsoft's RD-Agent enterprise framework (2026): thousands of
 * synthetic personas with messy habits, forgotten files, pushy managers, and
 * conflicting requests. Agents trained against THIS noise solve real
 * enterprise tasks much better than agents trained on clean toy datasets.
 *
 * Each persona carries enough realistic friction to exercise the agent
 * stack — broken emails, partial profiles, urgency mismatches, contradicting
 * priorities. The harness picks weighted-randomly from these when seeding a
 * sim business's customer table / support ticket queue / inbound feedback.
 *
 * NOTE — every email here is in a documented reserved domain
 * (`example.com`, `example.net`, `example.org` per RFC 2606) so a misfired
 * agent that tries to actually email someone hits a non-existent recipient
 * rather than a real human. The simulation harness ALSO enforces this at
 * the cost-guard layer (see lib/cost-guard.ts simulation short-circuit).
 */

export interface SimulationPersona {
  /** Stable id — lets the harness reproduce the same persona deterministically. */
  id:               string
  /** Display name. Often with a typo / informal capitalisation, on purpose. */
  name:             string
  /** Reserved-domain email; intentionally messy. */
  email:            string
  /** What this persona is here for — drives ticket / message generation. */
  archetype:
    | 'happy_customer'
    | 'silent_lurker'
    | 'pushy_manager'
    | 'confused_newbie'
    | 'discount_seeker'
    | 'churn_threat'
    | 'integrator_partner'
    | 'press_inquirer'
    | 'support_storm'
    | 'evangelist'
  /** Hand-crafted notes that show up on the persona card in the harness UI. */
  notes:            string
  /** 0–1 weight — how often this persona shows up when the harness picks at random. */
  weight:           number
  /** Tone the persona uses in writing — drives LLM ticket-body generation. */
  voice:            'casual' | 'angry' | 'polite' | 'corporate' | 'overformal' | 'panicked'
}

export const SIM_PERSONAS: SimulationPersona[] = [
  {
    id:        'jp-loyal',
    name:      'JP',
    email:     'jp@example.com',
    archetype: 'evangelist',
    notes:     'Long-time customer. Sends product feedback weekly, unsolicited. Sometimes useful, often vibes.',
    weight:    1,
    voice:     'casual',
  },
  {
    id:        'megan-corp',
    name:      'Megan Ortiz-Lao',
    email:     'megan.ortiz-lao@example.com',
    archetype: 'pushy_manager',
    notes:     'VP Marketing at a 50-person SaaS. Always "ASAP needed by EOD" framing. Will escalate to CEO if reply > 4 hrs.',
    weight:    0.6,
    voice:     'corporate',
  },
  {
    id:        'leo-broken-email',
    name:      'leo',
    email:     'lE0.ANGRY+spam@example.net',   // mixed case + + alias on purpose
    archetype: 'churn_threat',
    notes:     'Threatens to cancel every 3 days. Has never actually cancelled. Email parser must handle the +alias correctly.',
    weight:    0.8,
    voice:     'angry',
  },
  {
    id:        'akiko-newbie',
    name:      'Akiko T.',
    email:     'akiko.t@example.org',
    archetype: 'confused_newbie',
    notes:     'New customer. Asks basic onboarding questions the docs answer. Patient but easily lost.',
    weight:    1.2,
    voice:     'polite',
  },
  {
    id:        'lukas-discount',
    name:      'Lukas',
    email:     'lukas@example.com',
    archetype: 'discount_seeker',
    notes:     'Replies to every email with "any discount codes available?" — never buys at full price.',
    weight:    0.5,
    voice:     'casual',
  },
  {
    id:        'priya-silent',
    name:      'Priya R.',
    email:     'priya.r@example.com',
    archetype: 'silent_lurker',
    notes:     'On the email list since launch. Opens every newsletter. Never replies. Closed a $1k deal last month after 14 months of silence.',
    weight:    0.3,
    voice:     'polite',
  },
  {
    id:        'support-flood',
    name:      'Support Storm',
    email:     'multiple@example.com',
    archetype: 'support_storm',
    notes:     'Synthetic group — represents the 12 tickets that all come in within an hour of a deploy. Different humans, same root issue.',
    weight:    0.4,
    voice:     'panicked',
  },
  {
    id:        'integrator-shopify',
    name:      'Daniel from Shopify Plus',
    email:     'daniel@example.org',
    archetype: 'integrator_partner',
    notes:     'Wants to white-label the product. Long deal cycles, high LTV but never urgent.',
    weight:    0.2,
    voice:     'corporate',
  },
  {
    id:        'press-techcrunch',
    name:      'A. Sandeep',
    email:     'press@example.org',
    archetype: 'press_inquirer',
    notes:     'Says they\'re writing a piece. Probably not. 3-hour deadline. Decline politely or seize the moment.',
    weight:    0.1,
    voice:     'overformal',
  },
  {
    id:        'happy-renewer',
    name:      'Tess',
    email:     'tess+sub@example.com',
    archetype: 'happy_customer',
    notes:     'Auto-renews every quarter. No feedback ever. Disappears when you finally email asking what she\'d change. The silent profitable majority.',
    weight:    1.5,
    voice:     'casual',
  },
]

/** Pick one persona by weighted random. Pure — caller provides Math.random for determinism if needed. */
export function pickPersona(rng: () => number = Math.random): SimulationPersona {
  const total = SIM_PERSONAS.reduce((s, p) => s + p.weight, 0)
  let pick = rng() * total
  for (const p of SIM_PERSONAS) {
    pick -= p.weight
    if (pick <= 0) return p
  }
  return SIM_PERSONAS[SIM_PERSONAS.length - 1]
}

/** Pick N distinct personas, weighted but without replacement. Used for seeding. */
export function pickPersonas(n: number, rng: () => number = Math.random): SimulationPersona[] {
  const remaining = [...SIM_PERSONAS]
  const out: SimulationPersona[] = []
  while (out.length < Math.min(n, SIM_PERSONAS.length)) {
    const total = remaining.reduce((s, p) => s + p.weight, 0)
    let pick = rng() * total
    let i = 0
    for (; i < remaining.length; i++) {
      pick -= remaining[i].weight
      if (pick <= 0) break
    }
    const chosen = remaining.splice(Math.min(i, remaining.length - 1), 1)[0]
    out.push(chosen)
  }
  return out
}
