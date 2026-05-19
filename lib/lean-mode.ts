/**
 * lean-mode — feature flag that switches Nexus from multi-tenant production
 * shape (per-business gateways, Stripe attribution, RLS partitions, tiered
 * cost-guard) into a single-owner solo-dev shape (one shared gateway, plain
 * Stripe metadata, global cost cap).
 *
 * The multi-tenant code stays in tree, dormant — flipping LEAN_MODE back to
 * 0 restores the production behaviour without a merge.
 *
 * Boundary points that read this flag:
 *   - app/api/businesses/[slug]/provision/route.ts   (Task 4)
 *   - app/api/cron/scale-down-businesses/route.ts    (Task 5)
 *   - lib/cost-guard.ts checkKillSwitch              (Task 7)
 *   - lib/composio/actions.ts executeBusinessAction  (Task 8)
 *   - any Stripe payment_intent.create with metadata.business_slug (Task 6)
 *
 * See docs/runbooks/lean-mode.md for cutover + revert procedure.
 */

export const LEAN_MODE_DOCS_URL =
  'https://github.com/pinnacleadvisors/nexus/blob/main/docs/runbooks/lean-mode.md'

/**
 * True when LEAN_MODE=1 is set in the environment. Single source of truth —
 * every guard imports this rather than reading process.env directly so the
 * flag's call sites are greppable.
 */
export function isLeanMode(): boolean {
  return process.env.LEAN_MODE === '1'
}

/**
 * Throws when called in lean mode. Wrap dormant scale-mode code paths with
 * this at the entry point so the path self-documents — if a caller ever
 * reaches it under LEAN_MODE=1, the stack trace points at the boundary that
 * should have short-circuited.
 *
 * Example:
 *   if (isLeanMode()) return softError('disabled in lean mode')
 *   assertScaleMode('per-business provisioning')
 *   // ... scale-mode code below ...
 */
export function assertScaleMode(reason: string): void {
  if (isLeanMode()) {
    throw new Error(
      `[lean-mode] Refusing to run scale-mode code path: ${reason}. ` +
      `See ${LEAN_MODE_DOCS_URL} for context.`,
    )
  }
}

/**
 * Per-call global cost cap in lean mode. Replaces the per-business +
 * per-user tier model with a single global daily ceiling. Default $5/day —
 * generous for solo development, tight enough to catch a runaway loop.
 */
export function leanModeDailyUsdLimit(): number {
  const raw = process.env.LEAN_USER_DAILY_USD_LIMIT
  if (!raw) return 5
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : 5
}
