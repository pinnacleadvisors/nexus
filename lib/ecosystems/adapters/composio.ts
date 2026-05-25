/**
 * lib/ecosystems/adapters/composio.ts — `workflow` adapter (real).
 *
 * Wraps lib/composio/actions.ts. The Composio toolkit is a thin
 * pass-through for any of the 500+ OAuth platforms the operator has
 * connected — so the verb shape is intentionally generic:
 *
 *   payload: { userId, businessSlug, platform, actionSlug, arguments }
 *
 * The `workflow` kind isn't a perfect fit (n8n is the "canonical" workflow
 * adapter we'll add later) but Composio is the right home for "run an
 * arbitrary action on a connected account" — it's the closest thing
 * Nexus has to a universal automation primitive today.
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'
import { executeBusinessAction, ConnectedAccountMissingError } from '@/lib/composio/actions'

const VERBS = ['run_action'] as const
type Verb = (typeof VERBS)[number]

interface RunActionPayload {
  userId:        string
  businessSlug?: string | null
  platform:      string
  /** The Composio action slug. Named `action` to match `ExecuteBusinessActionInput`. */
  action:        string
  arguments?:    Record<string, unknown>
}

function envOk(): boolean {
  // Composio is reachable via lib/composio/client.ts which reads
  // COMPOSIO_API_KEY (per repo conventions) — if it's missing the helper
  // throws on first use. The cheap check below is documentary.
  return Boolean(process.env.COMPOSIO_API_KEY)
}

export const composioAdapter: EcosystemAdapter = {
  kind:         'workflow',
  name:         'composio',
  label:        'Composio (OAuth fan-out)',
  capabilities: VERBS,
  available:    envOk,
  invoke:       invokeComposio,
}

async function invokeComposio(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!composioAdapter.available()) return unavailable('composio', verb, 'Set COMPOSIO_API_KEY in Doppler.')
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('composio', verb, VERBS)
  const p = (payload ?? {}) as Partial<RunActionPayload>
  if (!p.userId || !p.platform || !p.action) {
    return {
      ok: false, adapter: 'composio', verb,
      error: 'upstream_error',
      message: 'run_action requires userId, platform, action in payload',
    }
  }
  try {
    const data = await executeBusinessAction({
      userId:       p.userId,
      businessSlug: p.businessSlug ?? null,
      platform:     p.platform,
      action:       p.action,
      arguments:    p.arguments ?? {},
    })
    return { ok: true, adapter: 'composio', verb, result: data }
  } catch (e) {
    if (e instanceof ConnectedAccountMissingError) {
      return {
        ok: false, adapter: 'composio', verb,
        error: 'upstream_error',
        message: `${p.platform} not connected for this scope — connect it in /settings/accounts and retry.`,
      }
    }
    return { ok: false, adapter: 'composio', verb, error: 'upstream_error', message: e instanceof Error ? e.message : 'composio call failed' }
  }
}
