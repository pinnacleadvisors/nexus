/**
 * lib/notifications/operators.ts — resolve the list of operator userIds.
 *
 * For Nexus's single-owner topology, the operator allowlist is
 * `ALLOWED_USER_IDS` (comma-separated Clerk user ids), the same env var
 * proxy.ts uses to gate protected routes. This module is the canonical
 * place to read it so notification dispatchers don't each parse the env
 * var themselves.
 *
 * Returns the empty array when:
 *   - ALLOWED_USER_IDS is unset (pre-setup mode — silently skip notifies)
 *   - The env var is malformed
 *
 * Never throws — callers should fire-and-forget against this list.
 */

/** Comma- or whitespace-separated list, lowercased prefix accepted. */
export function listOperatorUserIds(): string[] {
  const raw = (process.env.ALLOWED_USER_IDS ?? '').trim()
  if (!raw) return []
  return raw
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

/** First operator (the canonical owner in single-owner mode). Convenience
 *  helper when fan-out doesn't make sense (e.g. the weekly-digest cron). */
export function getPrimaryOperatorUserId(): string | null {
  const ids = listOperatorUserIds()
  return ids[0] ?? null
}
