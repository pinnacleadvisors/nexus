/**
 * Codex CLI gateway dispatcher — sandbox / manual-ops counterpart to
 * dispatchToOpenClaw and the Claude Code gateway.
 *
 * Speaks the same HMAC-signed protocol as services/claude-gateway, just
 * pointed at services/codex-gateway. Reads CODEX_GATEWAY_URL +
 * CODEX_GATEWAY_BEARER_TOKEN from env. Returns null when unconfigured so
 * callers can fall through to the existing Claude / OpenClaw chain.
 *
 * See ADR 002 for the two-gateway architecture rationale.
 */

import {
  callGateway,
  callGatewayStream,
  type GatewayStreamCallbacks,
} from './gateway-call'

export function isCodexGatewayConfigured(): boolean {
  return Boolean(
    process.env.CODEX_GATEWAY_URL &&
    process.env.CODEX_GATEWAY_BEARER_TOKEN,
  )
}

/**
 * Heuristic for whether a model id should route to the Codex gateway.
 * Treats anything starting with `gpt` (case-insensitive) as Codex-bound;
 * an explicit `codex:` prefix is also accepted for symmetry with internal
 * agent slugs.
 */
export function shouldRouteToCodex(model: string | null | undefined): boolean {
  if (!model) return false
  const m = model.trim().toLowerCase()
  return m.startsWith('gpt') || m.startsWith('codex')
}

export interface CodexDispatchOpts {
  agentSlug:   string
  message:     string
  env:         Record<string, string>
  userId?:     string
  /** Free-form session tag. When unset, a tag derived from agentSlug + ts is used. */
  sessionTag?: string
  /** Default 30s — must fit inside the dispatch route's 45s maxDuration. */
  timeoutMs?:  number
}

export interface CodexDispatchResult {
  ok:        boolean
  sessionId: string
  status:    number
  text:      string
  error?:    string
}

/**
 * Synchronous dispatch to the Codex gateway. Returns null when codex is
 * unconfigured so the caller can fall through.
 */
export async function dispatchToCodexGateway(
  opts: CodexDispatchOpts,
): Promise<CodexDispatchResult | null> {
  const gatewayUrl  = process.env.CODEX_GATEWAY_URL
  const bearerToken = process.env.CODEX_GATEWAY_BEARER_TOKEN
  if (!gatewayUrl || !bearerToken) return null

  const sessionTag = opts.sessionTag
    ?? `nexus-codex-${opts.agentSlug}-${Date.now()}`

  const result = await callGateway({
    gatewayUrl,
    bearerToken,
    sessionTag,
    message:    opts.message,
    agentSlug:  opts.agentSlug,
    env:        opts.env,
    userId:     opts.userId,
    timeoutMs:  opts.timeoutMs ?? 30_000,
  })

  return {
    ok:        result.ok,
    sessionId: sessionTag,
    status:    result.status,
    text:      result.text,
    error:     result.error,
  }
}

/**
 * Streaming variant — used by chat / agent surfaces when the user has
 * explicitly selected a Codex-class model. Returns null when unconfigured.
 */
export async function streamCodexGateway(
  opts: CodexDispatchOpts,
  callbacks: GatewayStreamCallbacks,
): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string } | null> {
  const gatewayUrl  = process.env.CODEX_GATEWAY_URL
  const bearerToken = process.env.CODEX_GATEWAY_BEARER_TOKEN
  if (!gatewayUrl || !bearerToken) return null

  const sessionTag = opts.sessionTag
    ?? `nexus-codex-${opts.agentSlug}-${Date.now()}`

  return callGatewayStream(
    {
      gatewayUrl,
      bearerToken,
      sessionTag,
      message:   opts.message,
      agentSlug: opts.agentSlug,
      env:       opts.env,
      userId:    opts.userId,
      timeoutMs: opts.timeoutMs ?? 120_000,
    },
    callbacks,
  )
}
