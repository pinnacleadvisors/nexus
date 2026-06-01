/**
 * Resolve the operator's `execution_mode` provider preference into the
 * claude-gateway's per-turn `execMode` (the subscription-billing control).
 *
 * Background — why this matters (see services/claude-gateway/src/spawnPty.ts):
 * `claude -p` bills at the expensive API per-token rate even with an OAuth /
 * Max subscription (anthropics/claude-code #43333, #37686), and the June-15-2026
 * billing change cements this. The ONLY way to bill against the flat Max/Pro
 * subscription is to run Claude Code INTERACTIVELY in a pseudo-terminal —
 * gateway `execMode: 'pty'`.
 *
 * Mapping:
 *   'node-pty'      → 'pty'    (interactive — real Max/Pro billing)
 *   'subscription'  → 'pty'    (the label literally means "bill my subscription";
 *                               the `-p` "subscription" path was a trap that billed
 *                               API, so we route subscription-intent to the path
 *                               that actually achieves it)
 *   'api'           → 'print'  (`claude -p` — deliberate per-token API billing)
 *   (unset)         → undefined (gateway falls back to CLAUDE_DEFAULT_EXEC_MODE)
 */
import { getProviderPrefs, type ExecutionMode } from '@/lib/user-secrets'

export type GatewayExecMode = 'print' | 'pty'

/** Pure mapping — unit-tested. */
export function execModeFromPref(pref: ExecutionMode | undefined): GatewayExecMode | undefined {
  if (pref === 'api') return 'print'
  if (pref === 'node-pty' || pref === 'subscription') return 'pty'
  return undefined
}

/** Read the anthropic provider preference and resolve execMode. Fail-soft:
 *  any error (Supabase down, no row) → undefined so the gateway default applies. */
export async function resolveExecMode(userId: string): Promise<GatewayExecMode | undefined> {
  try {
    const prefs = await getProviderPrefs(userId, 'anthropic')
    return execModeFromPref(prefs.execution_mode)
  } catch {
    return undefined
  }
}
