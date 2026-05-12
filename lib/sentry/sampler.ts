/**
 * Shared Sentry `tracesSampler` for server / edge / client configs.
 *
 * Why: switching from `tracesSampleRate: 1` (100% sampling) to a sampler
 * function fixes the 5M-spans-in-3-days budget burn caused by polling
 * endpoints. The chat-poll endpoint alone fires every 2.5s during any active
 * agent run, and the dashboard's `<GatewayStatusPill>` + `<Sidebar>` cron
 * health probe fire every 30s on every protected page — that's the bulk of
 * the span volume, and none of it is high-signal performance data.
 *
 * Strategy:
 *   - High-volume polling endpoints → sample at 0 (skip the transaction
 *     entirely; no spans generated).
 *   - Webhook receivers (Vercel log drain, Clerk webhook, etc.) → also 0;
 *     they're high-volume and self-amplifying (see AGENTS.md "Webhook
 *     self-amplification checklist").
 *   - One-shot user actions and most page loads → 5% baseline.
 *   - Hand-off boundaries that DO benefit from full visibility (the
 *     dispatch entrypoint, OAuth callbacks) → 100% so we can see the full
 *     trace when they fail.
 *
 * Errors are unaffected — `Sentry.captureException` always sends regardless
 * of the trace-sampling rate. We're trading performance traces (which we
 * weren't analysing anyway) for staying under budget.
 */

import type { SamplingContext } from '@sentry/core'

/** Patterns that match ROUTE/transaction names we want to skip entirely. */
const SKIP_PATTERNS: RegExp[] = [
  /\/api\/platform-chat\/poll/,    // Chat polling — fires every 2.5s during a run
  /\/api\/gateway-status/,         // GatewayStatusPill — every 30s, every protected page
  /\/api\/health\/cron/,           // Sidebar cron health probe — every 30s
  /\/api\/vercel\/log-drain/,      // Self-amplifying webhook — bypassed in proxy.ts already
  /\/api\/connected-accounts(\?|$)/, // List endpoint, frequently re-fetched by AccountList
]

/** Patterns that benefit from full visibility — keep at 100% even though they're not errors. */
const HIGH_VALUE_PATTERNS: RegExp[] = [
  /\/api\/claude-session\/dispatch/,
  /\/api\/connected-accounts\/(init|callback|api-key)/,
  /\/api\/webhooks\//,
  /\/api\/businesses\/[^/]+\/provision/,
]

const BASELINE = 0.05

export function tracesSampler(ctx: SamplingContext): number {
  // Inherit the parent's decision when present — keeps a multi-span trace
  // consistent rather than half-sampled-half-not.
  if (typeof ctx.parentSampled === 'boolean') return ctx.parentSampled ? 1 : 0

  const name = ctx.name ?? ctx.transactionContext?.name ?? ''
  const op   = (ctx.attributes?.['http.method'] as string | undefined) ?? ''

  for (const p of SKIP_PATTERNS)       if (p.test(name)) return 0
  for (const p of HIGH_VALUE_PATTERNS) if (p.test(name)) return 1

  // GET requests are usually idempotent reads — sample less aggressively
  // than mutating verbs.
  if (op === 'GET') return BASELINE / 2

  return BASELINE
}
