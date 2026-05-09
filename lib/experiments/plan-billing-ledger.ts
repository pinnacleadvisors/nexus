/**
 * plan-billing-ledger — answers "is this experiment paying for itself?"
 *
 * The Claude Max 20x and Codex Pro subscriptions are flat-rate; their
 * marginal compute cost is $0 once spent. This ledger computes what the
 * same compute WOULD have cost on the per-token API tier (Anthropic /
 * OpenAI list prices) and compares it to the experiment's revenue.
 *
 * If `revenueUsd / totalUsd ≥ 1`, the experiment has earned back its share
 * of the plan budget at API-equivalent rates. The dashboard surfaces this
 * ratio plus the per-vendor breakdown so the operator can see whether
 * Claude or Codex is doing the heavy lifting (and whether the right plan
 * tier is in place).
 *
 * Data flow:
 *   - read `token_events` rows for the business since `sinceTs`
 *   - look up pricing by `model`; sum hypothetical USD by category
 *   - read `experiment_metrics` rows where `kind=revenue` since `sinceTs`
 *   - return `{ claudeUsd, codexUsd, totalUsd, revenueUsd, ratioVsRevenue }`
 *
 * Per-tick persistence happens in the cron route (C2) — it calls
 * `estimatePlanBillingUsage` and writes a `kind=plan_billing_estimate`
 * row to experiment_metrics with the result as payload.
 */

import { createServerClient } from '@/lib/supabase'

/** Per-1M-tokens pricing for the listed model on its respective API tier. */
export interface PlanBillingPricing {
  inputPerMillion:  number
  outputPerMillion: number
  category:         'claude' | 'codex'
}

/**
 * Anthropic + OpenAI list prices as of plan publish time. Update when
 * pricing changes — the ledger compares hypothetical API cost so accuracy
 * here directly shapes the operator's amortization signal.
 */
export const PRICING: Readonly<Record<string, PlanBillingPricing>> = {
  // Claude (Anthropic) per https://www.anthropic.com/pricing
  'claude-opus-4-7':       { inputPerMillion: 15,    outputPerMillion: 75,   category: 'claude' },
  'claude-opus-4-6':       { inputPerMillion: 15,    outputPerMillion: 75,   category: 'claude' },
  'claude-sonnet-4-6':     { inputPerMillion: 3,     outputPerMillion: 15,   category: 'claude' },
  'claude-sonnet-4-5':     { inputPerMillion: 3,     outputPerMillion: 15,   category: 'claude' },
  'claude-haiku-4-5':      { inputPerMillion: 0.80,  outputPerMillion: 4,    category: 'claude' },
  // Codex / GPT-5.5 (OpenAI) approximate list rates
  'gpt-5.5-codex':         { inputPerMillion: 5,     outputPerMillion: 15,   category: 'codex' },
  'gpt-5.5':               { inputPerMillion: 5,     outputPerMillion: 15,   category: 'codex' },
} as const

export interface TokenRow {
  model:         string
  input_tokens:  number
  output_tokens: number
}

export interface PlanBillingEstimate {
  /** Hypothetical API USD if all Claude rows had been API-billed. */
  claudeUsd:       number
  /** Hypothetical API USD if all Codex/GPT-5.5 rows had been API-billed. */
  codexUsd:        number
  /** claudeUsd + codexUsd. */
  totalUsd:        number
  /** Sum of experiment_metrics.kind=revenue payload.usd values in the window. */
  revenueUsd:      number
  /**
   * revenueUsd / totalUsd — > 1 means the experiment has earned back more
   * than the API-equivalent of compute consumed. `null` when totalUsd is 0
   * (no compute = the ratio is undefined, not infinite).
   */
  ratioVsRevenue:  number | null
  /** Count of token_events rows analyzed (debug aid). */
  rowsAnalyzed:    number
  /** Models seen in the data that aren't in PRICING — silently zero-counted. */
  unmatchedModels: readonly string[]
  /** Time-window upper bound (computed-at). */
  computedAt:      string
}

/**
 * Pure aggregation — given raw token rows + a revenue total, compute the
 * estimate. Exposed so callers can pre-filter rows or stub the DB shell
 * for tests without hitting Supabase.
 */
export function aggregatePlanBilling(
  rows:        readonly TokenRow[],
  revenueUsd:  number,
  now?:        Date,
): PlanBillingEstimate {
  let claudeUsd = 0
  let codexUsd  = 0
  const unmatched = new Set<string>()

  for (const r of rows) {
    const p = PRICING[r.model]
    if (!p) {
      unmatched.add(r.model)
      continue
    }
    const cost =
      (r.input_tokens  / 1_000_000) * p.inputPerMillion +
      (r.output_tokens / 1_000_000) * p.outputPerMillion
    if (p.category === 'claude') claudeUsd += cost
    else                          codexUsd += cost
  }

  const totalUsd = claudeUsd + codexUsd
  const ratioVsRevenue = totalUsd > 0 ? revenueUsd / totalUsd : null

  return {
    claudeUsd:       round6(claudeUsd),
    codexUsd:        round6(codexUsd),
    totalUsd:        round6(totalUsd),
    revenueUsd:      round6(revenueUsd),
    ratioVsRevenue:  ratioVsRevenue === null ? null : round6(ratioVsRevenue),
    rowsAnalyzed:    rows.length,
    unmatchedModels: [...unmatched].sort(),
    computedAt:      (now ?? new Date()).toISOString(),
  }
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000
}

/**
 * Async shell — fetches token_events + revenue rows for the business
 * since `sinceTs` (default: 30 days ago) and delegates to
 * `aggregatePlanBilling`. Fail-soft on DB errors — returns a zeroed
 * estimate the dashboard can render without throwing.
 */
export async function estimatePlanBillingUsage(
  businessSlug: string,
  sinceTs?:     Date,
): Promise<PlanBillingEstimate> {
  const since = sinceTs ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const sinceIso = since.toISOString()
  const empty = aggregatePlanBilling([], 0)

  const db = createServerClient()
  if (!db) return empty

  try {
    const tokenRes = await db
      .from('token_events')
      .select('model,input_tokens,output_tokens')
      .eq('business_slug', businessSlug)
      .gte('created_at', sinceIso)

    // experiment_metrics not in generated types yet — same shim pattern as
    // lib/cost-guard.ts's checkKillSwitch.
    type AnyQuery = {
      eq:  (c: string, v: string) => AnyQuery
      gte: (c: string, v: string) => AnyQuery
      then: Promise<{ data: unknown; error: unknown }>['then']
    }
    const exp = (db as unknown as {
      from: (t: string) => { select: (c: string) => AnyQuery }
    }).from('experiment_metrics')

    const revRes = (await exp
      .select('payload')
      .eq('business_slug', businessSlug)
      .eq('kind', 'revenue')
      .gte('ts', sinceIso)) as { data: unknown; error: unknown }

    const tokenRows = ((tokenRes.data ?? []) as Array<{
      model: string | null
      input_tokens: number | null
      output_tokens: number | null
    }>).map(r => ({
      model:         r.model         ?? 'unknown',
      input_tokens:  r.input_tokens  ?? 0,
      output_tokens: r.output_tokens ?? 0,
    }))

    const revRows = (revRes.data ?? []) as Array<{ payload?: Record<string, unknown> | null }>
    const revenueUsd = revRows.reduce((s, r) => {
      const p = r.payload ?? {}
      return s + (typeof p.usd === 'number' ? (p.usd as number) : 0)
    }, 0)

    return aggregatePlanBilling(tokenRows, revenueUsd)
  } catch {
    return empty
  }
}
