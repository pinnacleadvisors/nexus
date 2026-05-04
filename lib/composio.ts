/**
 * Composio client — thin fetch wrapper around Composio's REST API.
 *
 * Used by `/api/composio/doppler` to broker OAuth-authenticated Doppler
 * secret reads on behalf of Claude Code web cloud sessions.
 *
 * Composio handles the Doppler OAuth dance once (manual step in their
 * dashboard); this code just executes pre-defined actions against the
 * resulting `connected_account_id`.
 *
 * Required env vars:
 *   COMPOSIO_API_KEY                       — Composio API key
 *   COMPOSIO_DOPPLER_CONNECTED_ACCOUNT_ID  — the connected Doppler account
 *   DOPPLER_PROJECT_                       — Doppler project to read from
 *                                            (trailing _ required — Doppler
 *                                             reserves the unsuffixed names)
 *   DOPPLER_CONFIG_                        — Doppler config (e.g. `prd`, `dev`)
 *
 * Optional:
 *   COMPOSIO_BASE_URL                       — default https://backend.composio.dev
 *   COMPOSIO_DOPPLER_GET_ACTION             — default `DOPPLER_GET_SECRET`
 */

const DEFAULT_BASE_URL = 'https://backend.composio.dev'
const DEFAULT_GET_ACTION = 'DOPPLER_GET_SECRET'

export class ComposioError extends Error {
  status: number
  constructor(message: string, status = 500) {
    super(message)
    this.status = status
  }
}

interface ExecuteActionInput {
  action: string
  connectedAccountId: string
  arguments: Record<string, unknown>
}

async function executeAction({ action, connectedAccountId, arguments: args }: ExecuteActionInput): Promise<unknown> {
  const apiKey = process.env.COMPOSIO_API_KEY
  if (!apiKey) throw new ComposioError('COMPOSIO_API_KEY not configured', 500)

  const baseUrl = process.env.COMPOSIO_BASE_URL ?? DEFAULT_BASE_URL
  const url = `${baseUrl.replace(/\/$/, '')}/api/v3/actions/${encodeURIComponent(action)}/execute`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ connectedAccountId, arguments: args }),
    // 20s — Composio may take a few seconds to round-trip to a connected
    // service (Doppler, etc.); cap to prevent function-second pile-up.
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ComposioError(
      `Composio action ${action} failed: ${res.status} ${body.slice(0, 200)}`,
      res.status,
    )
  }
  return res.json()
}

/**
 * Fetch a list of Doppler secrets by name through Composio.
 * Returns a `{ name: value }` map. Missing secrets are omitted (not thrown)
 * so the broker can return partial success.
 */
export async function fetchDopplerSecrets(names: string[]): Promise<Record<string, string>> {
  const connectedAccountId = process.env.COMPOSIO_DOPPLER_CONNECTED_ACCOUNT_ID
  // Trailing _ is required: Doppler reserves DOPPLER_PROJECT / DOPPLER_CONFIG
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
      // Surface the first hard failure so the caller knows config is broken.
      // Per-secret 404s should be swallowed by Composio (returns empty data).
      if (err instanceof ComposioError && err.status === 401) throw err
      if (err instanceof ComposioError && err.status === 403) throw err
      // Otherwise: log and continue so partial success is possible
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[composio] fetch failed for ${name}:`, err)
      }
    }
  }

  return out
}
