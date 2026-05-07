/**
 * Doppler-specific Composio wrapper.
 *
 * Composio handles the Doppler OAuth dance once (manual step in their
 * dashboard); this module fetches secrets through the resulting
 * `COMPOSIO_DOPPLER_CONNECTED_ACCOUNT_ID`.
 *
 * Used by /api/composio/doppler to broker secret reads to Claude Code web
 * cloud sessions.
 *
 * Required env:
 *   COMPOSIO_DOPPLER_CONNECTED_ACCOUNT_ID  — the connected Doppler account
 *   DOPPLER_PROJECT_                       — Doppler project (trailing _ required)
 *   DOPPLER_CONFIG_                        — Doppler config (e.g. `prd`, `dev`)
 *
 * Optional env:
 *   COMPOSIO_DOPPLER_GET_ACTION             — default `DOPPLER_GET_SECRET`
 */

import { executeAction, ComposioError } from './client'

const DEFAULT_GET_ACTION = 'DOPPLER_GET_SECRET'

/**
 * Fetch a list of Doppler secrets by name through Composio.
 * Returns a `{ name: value }` map. Missing secrets are omitted (not thrown)
 * so the broker can return partial success.
 */
export async function fetchDopplerSecrets(names: string[]): Promise<Record<string, string>> {
  const connectedAccountId = process.env.COMPOSIO_DOPPLER_CONNECTED_ACCOUNT_ID
  // Trailing _ required: Doppler reserves DOPPLER_PROJECT / DOPPLER_CONFIG
  // as built-in metadata and rejects them as user-defined secret names.
  const project = process.env.DOPPLER_PROJECT_
  const config  = process.env.DOPPLER_CONFIG_
  if (!connectedAccountId) throw new ComposioError('COMPOSIO_DOPPLER_CONNECTED_ACCOUNT_ID not configured', 500)
  if (!project)            throw new ComposioError('DOPPLER_PROJECT_ not configured', 500)
  if (!config)             throw new ComposioError('DOPPLER_CONFIG_ not configured', 500)

  const action = process.env.COMPOSIO_DOPPLER_GET_ACTION ?? DEFAULT_GET_ACTION
  const out: Record<string, string> = {}

  // Sequential: small N (typically 5-15 secrets) and Composio rate-limits per
  // connection. Parallel would invite 429s and complicate retry.
  for (const name of names) {
    try {
      const result = (await executeAction({
        action,
        connectedAccountId,
        arguments: { project, config, name },
      })) as { data?: { value?: string; computed?: string } } | { value?: string }

      const value =
        (result as { data?: { value?: string; computed?: string } })?.data?.value ??
        (result as { data?: { value?: string; computed?: string } })?.data?.computed ??
        (result as { value?: string })?.value

      if (typeof value === 'string' && value.length > 0) {
        out[name] = value
      }
    } catch (err) {
      // Surface the first hard auth failure so the caller knows config is broken.
      // Per-secret 404s should be swallowed by Composio (returns empty data).
      if (err instanceof ComposioError && err.status === 401) throw err
      if (err instanceof ComposioError && err.status === 403) throw err
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[composio-doppler] fetch failed for ${name}:`, err)
      }
    }
  }

  return out
}
