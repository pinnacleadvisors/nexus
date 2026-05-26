/**
 * lib/simulation/check.ts — safety primitives for the RD-Agent-inspired
 * chaos harness (see lib/simulation/personas.ts + seed.ts).
 *
 * Two guard points:
 *   1. isSimulationBusiness(slug) — cached read against business_operators
 *   2. isMoneyMovingVerb(action)   — pattern match against the action name
 *
 * Both are stateless and synchronous-friendly. The cache is module-scoped
 * (a per-server-instance Map) — agents make many calls per tick so going
 * to the DB every time is wasteful. Cache TTL is 60s; long enough to amortise
 * a tick, short enough that an operator flipping `simulation=false` (e.g. to
 * graduate a sim business to real) takes effect promptly.
 *
 * Used by:
 *   - lib/cost-guard.ts   — short-circuits assertUnderCostCap for sim businesses
 *   - lib/composio/actions.ts — refuses money-moving verbs when sim=true
 */

import { createServerClient } from '@/lib/supabase'

interface CacheEntry {
  simulation: boolean
  fetchedAt:  number
}

const TTL_MS = 60_000
const cache = new Map<string, CacheEntry>()

/**
 * Returns true if the business is currently flagged as a simulation
 * (business_operators.simulation = true).
 *
 * Fail-soft: returns FALSE on any DB/network error — better to let the
 * action through to the existing cost-guard / approval gates than to
 * accidentally block real work because of a transient lookup miss.
 */
export async function isSimulationBusiness(slug: string | null | undefined): Promise<boolean> {
  if (!slug) return false
  const hit = cache.get(slug)
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.simulation

  const db = createServerClient()
  if (!db) {
    cache.set(slug, { simulation: false, fetchedAt: Date.now() })
    return false
  }

  try {
    const res = await (db.from('business_operators' as never) as unknown as {
      select: (c: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: { simulation?: boolean } | null; error: unknown }>
        }
      }
    }).select('simulation').eq('slug', slug).maybeSingle()
    const simulation = Boolean(res.data?.simulation)
    cache.set(slug, { simulation, fetchedAt: Date.now() })
    return simulation
  } catch (err) {
    console.warn('[lib/simulation/check] isSimulationBusiness lookup failed:', err instanceof Error ? err.message : err)
    cache.set(slug, { simulation: false, fetchedAt: Date.now() })
    return false
  }
}

/**
 * Pattern match — does this Composio action name move money or touch a
 * real human? Returns the matching category for logging or null for safe
 * verbs. Conservative: pattern includes string-substring on common
 * money/email/sms vocabulary across ~500 OAuth platforms.
 *
 * Caller should refuse to execute when this returns non-null AND the
 * target business is a simulation.
 */
export function classifyMoneyMovingVerb(action: string): string | null {
  const a = action.toLowerCase()

  // Stripe-class money moves
  if (a.includes('stripe') && (a.includes('charge') || a.includes('payment_intent') || a.includes('payout') || a.includes('refund'))) {
    return 'stripe_money_move'
  }
  // Email / SMS — anything that hits a real human
  if (/(^|_)send_email\b|create_message|send_message|sms_send|send_sms|email_send/.test(a)) {
    return 'send_message_to_human'
  }
  // Generic transfer / payout / withdraw across platforms (Coinbase, Wise, Mercury, etc.)
  if (/(^|_)transfer|(^|_)withdraw|(^|_)payout/.test(a) && !a.includes('list')) {
    return 'platform_money_move'
  }
  // Shopify / Stripe / commerce: creating an order or customer-facing artefact
  if (/create_(order|charge|invoice|subscription)\b/.test(a)) {
    return 'create_customer_facing_artefact'
  }
  // Slack to real channels (anything except #ops-test / sim channels) — sim
  // catches the broad case; the channel-specific allow-list is a follow-up.
  if (/slack.*post_message|slack.*send/.test(a)) {
    return 'slack_outbound'
  }

  return null
}

/**
 * Convenience: returns an Error to throw when a money-moving action is
 * invoked against a sim business. The message is operator-facing so a
 * dispatched agent's log makes the friction visible.
 */
export class SimulationGuardError extends Error {
  constructor(action: string, slug: string, category: string) {
    super(
      `Simulation safety: refused ${category} action "${action}" against ` +
      `business "${slug}" (simulation=true). Flip simulation=false on the ` +
      `business row to graduate it to real, or invoke a non-money-moving verb.`,
    )
    this.name = 'SimulationGuardError'
  }
}

/**
 * Clear the cache. Useful for tests + when the operator flips a business's
 * simulation flag and wants the change to take effect immediately.
 */
export function clearSimulationCache(): void {
  cache.clear()
}
