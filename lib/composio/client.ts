/**
 * Composio v3 API client.
 *
 * Three operations the rest of the codebase needs:
 *
 *   1. createConnectionLink   — POST /api/v3/connected_accounts/link
 *      Returns a hosted-OAuth redirect URL the user opens to authorise a
 *      third-party app. Replaces the deprecated `/connected_accounts/initiate`
 *      endpoint (sunset 2026-07-03 for existing orgs, 2026-05-08 for new).
 *
 *   2. executeAction          — POST /api/v3/tools/execute/{action_slug}
 *      Runs a tool action on behalf of a connected account. The action slug
 *      goes in the URL (e.g. TWITTER_CREATION_OF_A_POST), the connected
 *      account id + structured arguments go in the body.
 *
 *   3. disconnectAccount      — DELETE /api/v3/connected_accounts/{id}
 *      Revokes Composio's stored OAuth tokens for a connection.
 *
 * Required env:
 *   COMPOSIO_API_KEY                                 — the Composio API key
 *   COMPOSIO_AUTH_CONFIG_<TOOLKIT_SLUG_UPPER>        — per-toolkit auth config
 *                                                       id (created once in
 *                                                       Composio dashboard;
 *                                                       see lib/oauth/providers).
 *
 * Optional env:
 *   COMPOSIO_BASE_URL                                — default https://backend.composio.dev
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

function getApiKey(): string {
  const key = process.env.COMPOSIO_API_KEY
  if (!key) throw new ComposioError('COMPOSIO_API_KEY not configured', 500)
  return key
}

function getBaseUrl(): string {
  return (process.env.COMPOSIO_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
}

/**
 * Look up the auth_config_id for a toolkit. Each deployment creates its own
 * Auth Config in the Composio dashboard (one per toolkit it intends to use)
 * and stores the resulting id in an env var named
 * `COMPOSIO_AUTH_CONFIG_<TOOLKIT_SLUG>` (uppercase, no spaces).
 *
 * Returns null when not configured — the caller should surface a "create
 * Auth Config in Composio dashboard" error to the operator rather than
 * attempting the connection.
 */
export function getAuthConfigId(toolkitSlug: string): string | null {
  const key = `COMPOSIO_AUTH_CONFIG_${toolkitSlug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
  const val = process.env[key]
  return val && val.length > 0 ? val : null
}

// ── Connection link (replaces "initiate") ───────────────────────────────────

export interface CreateConnectionLinkInput {
  /** Composio Auth Config id (NOT the toolkit slug — that's set inside the auth config). */
  authConfigId:  string
  /** End-user identifier — Clerk userId works. Composio scopes connections per user. */
  userId:        string
  /** Where Composio should redirect after the user authorises. We embed our nonce in the query. */
  callbackUrl:   string
  /** Pre-fill values for any fields the auth config requires (e.g. shop subdomain for Shopify). */
  connectionData?: Record<string, unknown>
}

export interface CreateConnectionLinkResult {
  /** URL to open in the browser. */
  redirectUrl:         string
  /** Composio's id for the connection (returned now, also passed back on callback). */
  connectedAccountId:  string
  /** Composio's link session token. We don't strictly need it, but log for debugging. */
  linkToken:           string
  /** ISO timestamp the link expires. */
  expiresAt:           string
}

export async function createConnectionLink(input: CreateConnectionLinkInput): Promise<CreateConnectionLinkResult> {
  const url = `${getBaseUrl()}/api/v3/connected_accounts/link`
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key':    getApiKey(),
    },
    body: JSON.stringify({
      auth_config_id: input.authConfigId,
      user_id:        input.userId,
      callback_url:   input.callbackUrl,
      ...(input.connectionData ? { connection_data: input.connectionData } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ComposioError(`Composio /connected_accounts/link failed: ${res.status} ${body.slice(0, 200)}`, res.status)
  }
  const data = (await res.json()) as {
    redirect_url?:         string
    connected_account_id?: string
    link_token?:           string
    expires_at?:           string
  }
  if (!data.redirect_url || !data.connected_account_id || !data.link_token) {
    throw new ComposioError('Composio response missing redirect_url / connected_account_id / link_token', 502)
  }
  return {
    redirectUrl:        data.redirect_url,
    connectedAccountId: data.connected_account_id,
    linkToken:          data.link_token,
    expiresAt:          data.expires_at ?? '',
  }
}

// ── Tool action execution ───────────────────────────────────────────────────

export interface ExecuteActionInput {
  /** Composio action slug, e.g. TWITTER_CREATION_OF_A_POST. Goes in the URL. */
  action:             string
  connectedAccountId: string
  arguments:          Record<string, unknown>
  /** Default 20s — Composio round-trips can take a few seconds. */
  timeoutMs?:         number
  /** When set, Composio uses this entity sub-scope (multi-repo / multi-org). */
  entityId?:          string
  /** Tool version — leave undefined for "latest". */
  version?:           string
}

export async function executeAction(input: ExecuteActionInput): Promise<unknown> {
  const url = `${getBaseUrl()}/api/v3/tools/execute/${encodeURIComponent(input.action)}`
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key':    getApiKey(),
    },
    body: JSON.stringify({
      connected_account_id: input.connectedAccountId,
      arguments:            input.arguments,
      ...(input.entityId ? { entity_id: input.entityId } : {}),
      ...(input.version  ? { version:   input.version  } : {}),
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 20_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ComposioError(
      `Composio tool ${input.action} failed: ${res.status} ${body.slice(0, 200)}`,
      res.status,
    )
  }
  return res.json()
}

// ── Disconnect ───────────────────────────────────────────────────────────────

export async function disconnectAccount(connectedAccountId: string): Promise<void> {
  const url = `${getBaseUrl()}/api/v3/connected_accounts/${encodeURIComponent(connectedAccountId)}`
  const res = await fetch(url, {
    method:  'DELETE',
    headers: { 'x-api-key': getApiKey() },
    signal:  AbortSignal.timeout(10_000),
  })
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '')
    throw new ComposioError(`Composio disconnect failed: ${res.status} ${body.slice(0, 200)}`, res.status)
  }
}

// ── Back-compat shim ────────────────────────────────────────────────────────

/**
 * @deprecated Use createConnectionLink. Will be removed after one minor release.
 */
export async function initiateConnection(input: { integrationId: string; state: string; redirectUri: string; metadata?: Record<string, unknown> }): Promise<{ redirectUrl: string; connectionId: string }> {
  // Best-effort fallback — assumes the deprecated caller has the auth_config_id
  // in env keyed by the toolkit slug. Not all combinations resolve.
  const cfg = getAuthConfigId(input.integrationId)
  if (!cfg) {
    throw new ComposioError(`No COMPOSIO_AUTH_CONFIG_${input.integrationId.toUpperCase()} in env — run the new createConnectionLink path`, 500)
  }
  const url = new URL(input.redirectUri)
  url.searchParams.set('state', input.state)
  const result = await createConnectionLink({
    authConfigId: cfg,
    userId:       String((input.metadata?.nexusUserId as string | undefined) ?? 'unknown'),
    callbackUrl:  url.toString(),
  })
  return { redirectUrl: result.redirectUrl, connectionId: result.connectedAccountId }
}

export type InitiateConnectionInput  = { integrationId: string; state: string; redirectUri: string; metadata?: Record<string, unknown> }
export type InitiateConnectionResult = { redirectUrl: string; connectionId: string }
