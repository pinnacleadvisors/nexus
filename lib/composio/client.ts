/**
 * Generic Composio v3 action executor.
 *
 * Composio brokers OAuth-authenticated calls to 250+ third-party services
 * (Doppler, Twitter/X, LinkedIn, Gmail, Slack, Notion, etc.). Each connected
 * service is identified by a `connected_account_id` Composio returns from
 * its OAuth flow. This module is the lowest layer — it knows nothing about
 * which services exist; callers pass `{ action, connectedAccountId, args }`.
 *
 * Higher-level wrappers:
 *   - `lib/composio/doppler.ts`    — fetch Doppler secrets
 *   - `lib/composio/actions.ts`    — per-business action helper (looks up
 *                                    `connected_account_id` from DB)
 *
 * Required env:
 *   COMPOSIO_API_KEY        — Composio API key (Doppler-managed)
 *
 * Optional env:
 *   COMPOSIO_BASE_URL       — default https://backend.composio.dev
 */

const DEFAULT_BASE_URL = 'https://backend.composio.dev'

export class ComposioError extends Error {
  status: number
  constructor(message: string, status = 500) {
    super(message)
    this.status = status
    this.name = 'ComposioError'
  }
}

export interface ExecuteActionInput {
  action: string
  connectedAccountId: string
  arguments: Record<string, unknown>
  /** Override timeout. Default 20s — Composio round-trips can take a few seconds. */
  timeoutMs?: number
}

/**
 * POST /api/v3/actions/{action}/execute — returns whatever Composio's action
 * adapter returns. Callers are responsible for narrowing the response shape.
 */
export async function executeAction({
  action,
  connectedAccountId,
  arguments: args,
  timeoutMs = 20_000,
}: ExecuteActionInput): Promise<unknown> {
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
    signal: AbortSignal.timeout(timeoutMs),
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
 * Initiates a Composio OAuth connection for a given app + user. Returns the
 * hosted-OAuth redirect URL. The user opens it, authorizes, and Composio
 * fires its callback to our `/api/oauth/composio/callback` route with the
 * resulting `connected_account_id`.
 *
 * Reference: POST /api/v3/connected_accounts/initiate
 */
export interface InitiateConnectionInput {
  /** Composio integration ID (e.g. "twitter_v2", "linkedin", "gmail"). */
  integrationId: string
  /** Free-form correlation id used to round-trip business/user context through the OAuth redirect. */
  state: string
  /** Where Composio should redirect after the user authorises. */
  redirectUri: string
  /** Optional metadata stamped onto the connection. */
  metadata?: Record<string, unknown>
}

export interface InitiateConnectionResult {
  /** URL to open in the browser to begin the OAuth flow. */
  redirectUrl: string
  /** Composio's id for the in-flight connection (a finalised id is returned to the callback). */
  connectionId: string
}

export async function initiateConnection(input: InitiateConnectionInput): Promise<InitiateConnectionResult> {
  const apiKey = process.env.COMPOSIO_API_KEY
  if (!apiKey) throw new ComposioError('COMPOSIO_API_KEY not configured', 500)

  const baseUrl = process.env.COMPOSIO_BASE_URL ?? DEFAULT_BASE_URL
  const url = `${baseUrl.replace(/\/$/, '')}/api/v3/connected_accounts/initiate`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      integrationId: input.integrationId,
      state: input.state,
      redirectUri: input.redirectUri,
      metadata: input.metadata ?? {},
    }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ComposioError(
      `Composio initiate connection failed: ${res.status} ${body.slice(0, 200)}`,
      res.status,
    )
  }
  const data = (await res.json()) as { redirectUrl?: string; connectionId?: string }
  if (!data.redirectUrl || !data.connectionId) {
    throw new ComposioError('Composio response missing redirectUrl or connectionId', 502)
  }
  return { redirectUrl: data.redirectUrl, connectionId: data.connectionId }
}

/**
 * Disconnects a Composio connected account (revokes stored OAuth tokens).
 * Used by the Settings → Accounts UI's disconnect button.
 */
export async function disconnectAccount(connectedAccountId: string): Promise<void> {
  const apiKey = process.env.COMPOSIO_API_KEY
  if (!apiKey) throw new ComposioError('COMPOSIO_API_KEY not configured', 500)

  const baseUrl = process.env.COMPOSIO_BASE_URL ?? DEFAULT_BASE_URL
  const url = `${baseUrl.replace(/\/$/, '')}/api/v3/connected_accounts/${encodeURIComponent(connectedAccountId)}`

  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'x-api-key': apiKey },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '')
    throw new ComposioError(
      `Composio disconnect failed: ${res.status} ${body.slice(0, 200)}`,
      res.status,
    )
  }
}
