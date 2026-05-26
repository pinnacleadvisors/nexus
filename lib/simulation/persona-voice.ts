/**
 * lib/simulation/persona-voice.ts — pluggable ticket-body generators
 * for the hyperbolic-chamber simulation (v2-B, PR #367).
 *
 * Two generators with identical signatures:
 *   - voiceTemplate(persona, ticket, rng)  — sync, $0, deterministic.
 *     Mirrors v1's TICKET_BANK lookup with a tiny scrambler so two
 *     tickets from the same archetype don't read identical.
 *   - voiceLLM(persona, ticket, opts)      — async, costs ~$0.0001 per
 *     call at default model, calls the bound LLM via lib/llm/provider.ts.
 *     Fail-soft: if the call errors out, returns the template version
 *     so the run never stalls on a flaky provider.
 *
 * Engine picks which one based on `simulation_runs.synthetic_voice`.
 * Default is 'template' so existing v1 callers keep their $0 property.
 */

import { generateText } from 'ai'
import type { SimulationPersona } from './personas'
import { getLlm, activeProvider } from '@/lib/llm/provider'

export interface TicketSeed {
  title:     string
  archetype: SimulationPersona['archetype']
  sim_day:   number
  sim_hour:  number
}

// ── Templates (v1-compatible) ────────────────────────────────────────────────

const SCRAMBLERS = [
  (s: string) => s,
  (s: string) => s + ' Pls advise.',
  (s: string) => 'Sorry to bug you again, but ' + s.charAt(0).toLowerCase() + s.slice(1),
  (s: string) => 'FYI — ' + s,
  (s: string) => s.replace(/\.$/, '') + ' — when you have a sec.',
  (s: string) => s + '\n\nthanks',
]

const TICKET_BODIES: Record<SimulationPersona['archetype'], string[]> = {
  happy_customer:     ['just wanted to say the latest update is great', 'this is exactly what we needed, thanks team'],
  silent_lurker:      ['considering upgrading — what changes vs Pro?', 'is there a Team plan demo I can book?'],
  pushy_manager:      ['Our security review needs this filled out today. Forwarding the doc separately.', 'CEO asked — when is the SOC2 report coming?'],
  confused_newbie:    ['wait, I thought I was on the free plan? got a charge.', 'how do I cancel? cant find the button anywhere'],
  discount_seeker:    ['planning to upgrade — any deals coming up?', 'do you do non-profit pricing?'],
  churn_threat:       ['the export keeps failing. last warning before I cancel.', 'third support ticket this month. I am done.'],
  integrator_partner: ['circling back on the white-label discussion. our pricing review is next week.', 'API quota for Shopify Plus — when can we increase it?'],
  press_inquirer:     ['piece publishes 9am EST. one line on how you differentiate?', 'looking for a quote on agentic SaaS for our Q3 feature'],
  support_storm:      ['8 tickets in 20 min about signup failing. likely the deploy from this morning.', 'multiple users blocked on /checkout — page returns 500'],
  evangelist:         ['what if users could share their own templates? would unlock a flywheel.', 'idea: weekly community demo. happy to help organise'],
}

export function voiceTemplate(persona: SimulationPersona, ticket: TicketSeed, rng: () => number): string {
  const pool   = TICKET_BODIES[persona.archetype] ?? TICKET_BODIES.happy_customer
  const base   = pool[Math.floor(rng() * pool.length)]
  const scram  = SCRAMBLERS[Math.floor(rng() * SCRAMBLERS.length)]
  return scram(base) + `\n\n— ${persona.name} <${persona.email}> (day ${ticket.sim_day})`
}

// ── LLM voice (v2-B opt-in) ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are writing realistic, messy customer ticket bodies for a SaaS support inbox simulation. Real customers are imperfect:
  - lowercase first letters, contractions, occasional typos
  - inconsistent punctuation
  - urgent customers skip pleasantries; happy ones over-thank
  - tech-savvy customers use product-specific jargon; newbies use vague pronouns
Write ONLY the ticket body. No subject line, no signature, no quotes. 30-80 words. Match the persona's voice.`

export async function voiceLLM(
  persona: SimulationPersona,
  ticket: TicketSeed,
  opts?: { signal?: AbortSignal; modelOverride?: string },
): Promise<string> {
  const userPrompt = [
    `Persona: ${persona.name} (${persona.archetype})`,
    `Voice tone: ${persona.voice}`,
    `Notes: ${persona.notes}`,
    `Ticket subject: ${ticket.title}`,
    `Sim day: ${ticket.sim_day}`,
    `Write the body now.`,
  ].join('\n')

  try {
    const model = getLlm({ model: opts?.modelOverride })
    const { text } = await generateText({
      model,
      system:        SYSTEM_PROMPT,
      prompt:        userPrompt,
      maxOutputTokens: 200,
      temperature:   0.85,
      abortSignal:   opts?.signal,
    })
    const cleaned = text.trim()
    if (!cleaned) {
      // Fail-soft to the template
      return voiceTemplate(persona, ticket, () => Math.random())
    }
    return `${cleaned}\n\n— ${persona.name} <${persona.email}>`
  } catch (err) {
    // Log once but don't fail the tick — the sim must keep moving.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[sim/voiceLLM] provider=${activeProvider()} fell back to template:`, err instanceof Error ? err.message : err)
    }
    return voiceTemplate(persona, ticket, () => Math.random())
  }
}
