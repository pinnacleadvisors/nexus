/**
 * Async job client for the self-hosted Claude Code gateway.
 *
 * Companion to gateway-call.ts. The synchronous /api/sessions/:id/messages
 * endpoint blocks until the spawned CLI replies, so a Vercel function calling
 * it is bounded by Vercel's own maxDuration (60s on Hobby, 300s on Pro).
 * The async pair below decouples that: enqueue → poll. The Vercel function
 * returns a jobId in <1s; the client polls /api/n8n/generate/status which
 * proxies to GET /api/jobs/:jobId on the gateway.
 *
 * Auth shape mirrors `callGateway`:
 *   POST: bearer + HMAC over body + optional X-Nexus-User-Id
 *   GET:  bearer + optional X-Nexus-User-Id (no body to sign)
 */

import { createHmac } from 'node:crypto'
import { fetchAllowSelfSigned, isSelfSignedAllowed, SELF_SIGNED_ALLOW_ENV } from './self-signed-fetch'

export interface EnqueueJobOpts {
  gatewayUrl:   string
  bearerToken:  string
  /** Free-text prompt sent to Claude. */
  message:      string
  /** Agent spec slug — when set, .claude/agents/<slug>.md is loaded as system prompt. */
  agentSlug?:   string | null
  /** Per-request env overrides forwarded to the spawned CLI. */
  env?:         Record<string, string>
  /** Routing tag for logs. */
  sessionTag?:  string
  /** Clerk user id — sent as X-Nexus-User-Id, gated by ALLOWED_USER_IDS on the gateway. */
  userId?:      string
  /** Default 10s — only the enqueue call must fit; the actual generation is detached. */
  timeoutMs?:   number
  /**
   * Per-turn server-side timeout for the spawned Claude CLI (milliseconds).
   * Optional. When set, the gateway clamps this to its env cap REQUEST_MAX_MS
   * — never above. When omitted, the gateway uses its full env cap.
   *
   * Distinct from `timeoutMs` above: that one bounds the ENQUEUE fetch (~10s);
   * this one bounds the actual Claude turn (minutes).
   *
   * Wired in by task_plan-mobile-copilot.md Phase 1 (chat composer selector).
   */
  requestTimeoutMs?: number
  /**
   * Per-turn model override. Gateway passes through to `claude -p --model <id>`.
   * Phase 1 of task_plan-collaborative-chat.md. See lib/chat/models.ts for
   * the whitelist.
   */
  modelOverride?: string
  /**
   * Per-turn permission mode. Gateway forwards as NEXUS_CHAT_MODE env to the
   * spawned agent so the agent's system prompt can branch on ask/plan/auto.
   * Phase 1 of task_plan-collaborative-chat.md. See lib/chat/modes.ts.
   */
  mode?: 'ask' | 'plan' | 'auto'
  /**
   * Per-turn execution mode (subscription-billing control). 'print' = the
   * `claude -p` path (billed at API per-token rate). 'pty' = interactive
   * pseudo-terminal (billed against the Max/Pro subscription). Resolved from
   * the operator's `execution_mode` provider preference; 'node-pty' maps to
   * 'pty'. Omitted → the gateway's CLAUDE_DEFAULT_EXEC_MODE. See
   * services/claude-gateway/src/spawnPty.ts for the why.
   */
  execMode?: 'print' | 'pty'
}

export interface EnqueueJobResult {
  ok:      boolean
  jobId?:  string
  status?: 'pending'
  error?:  string
  http?:   number
}

function sign(bodyText: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(bodyText).digest('hex')
}

/**
 * Extract a useful error message from a Node fetch failure.
 *
 * Node's `fetch` (undici) wraps the underlying network error in a generic
 * `TypeError: fetch failed` and stashes the real cause (DNS / TCP / TLS /
 * timeout) on `.cause`. The bare message tells the operator nothing —
 * surfacing the cause + the URL hostname is what turns "it's broken" into
 * "the per-business gateway DNS doesn't resolve, the container is down".
 *
 * Examples after this transformation:
 *   getaddrinfo ENOTFOUND claude-gw.inkbound.example.com (host: …)
 *   connect ECONNREFUSED 127.0.0.1:3000 (host: …)
 *   self-signed certificate (host: …)
 *
 * Keeps the hostname only — never logs auth tokens or paths-with-secrets.
 */
function formatFetchError(err: unknown, url: string): string {
  let host = ''
  try { host = new URL(url).host } catch { /* malformed URL — already informative */ }
  const cause = (err as { cause?: unknown })?.cause
  const causeMsg = cause instanceof Error
    ? cause.message
    : typeof cause === 'string'
      ? cause
      : null
  const topMsg = err instanceof Error ? err.message : String(err)
  const baseMsg = causeMsg && topMsg.toLowerCase() === 'fetch failed' ? causeMsg : topMsg
  if (topMsg.toLowerCase().includes('abort')) return host ? `enqueue timed out (host: ${host})` : 'enqueue timed out'

  // Hint at the self-signed escape hatch when the failure looks like a
  // cert issue and the host ISN'T already in the allowlist — saves the
  // operator a doc lookup.
  const lower = (causeMsg ?? baseMsg).toLowerCase()
  const isCertError = lower.includes('self-signed certificate')
    || lower.includes('unable to verify the first certificate')
    || lower.includes('cert_has_expired')
    || lower.includes('certificate')
  if (isCertError && host && !isSelfSignedAllowed(host)) {
    return `${baseMsg} (host: ${host}) — to allow self-signed certs for this host, set ${SELF_SIGNED_ALLOW_ENV}=${suggestPattern(host)} in your Vercel env. Long-term fix: put the gateway behind Cloudflare Tunnel for a real cert (see docs/runbooks/per-business-container-rollout.md).`
  }
  return host ? `${baseMsg} (host: ${host})` : baseMsg
}

/** Suggest a sensible allowlist pattern for a host — wildcard for sslip/nip, literal otherwise. */
function suggestPattern(host: string): string {
  const h = host.toLowerCase()
  if (h.endsWith('.sslip.io')) return '*.sslip.io'
  if (h.endsWith('.nip.io'))   return '*.nip.io'
  return h
}

export async function enqueueGatewayJob(opts: EnqueueJobOpts): Promise<EnqueueJobResult> {
  const base = opts.gatewayUrl.replace(/\/$/, '')
  const url  = `${base}/api/jobs`
  const body = JSON.stringify({
    role:    'user',
    content: opts.message,
    agent:   opts.agentSlug ?? null,
    env:     opts.env ?? {},
    // Optional per-turn server-side timeout. Gateway clamps to its env cap.
    ...(opts.requestTimeoutMs !== undefined ? { requestTimeoutMs: opts.requestTimeoutMs } : {}),
    ...(opts.modelOverride ? { modelOverride: opts.modelOverride } : {}),
    ...(opts.mode ? { mode: opts.mode } : {}),
    ...(opts.execMode ? { execMode: opts.execMode } : {}),
  })

  const headers: Record<string, string> = {
    'Content-Type':         'application/json',
    'Authorization':        `Bearer ${opts.bearerToken}`,
    'X-Nexus-Signature':    sign(body, opts.bearerToken),
    'X-Nexus-Timestamp':    Date.now().toString(),
  }
  if (opts.userId)     headers['X-Nexus-User-Id']     = opts.userId
  if (opts.sessionTag) headers['X-Nexus-Session-Tag'] = opts.sessionTag

  const ac = new AbortController()
  const t  = setTimeout(() => ac.abort(), opts.timeoutMs ?? 10_000)
  try {
    const res = await fetchAllowSelfSigned(url, { method: 'POST', headers, body, signal: ac.signal })
    let parsed: unknown = null
    try { parsed = await res.json() } catch { /* leave null */ }
    if (!res.ok) {
      const err = (parsed && typeof parsed === 'object' && 'error' in parsed)
        ? String((parsed as { error: unknown }).error)
        : `gateway ${res.status}`
      return { ok: false, error: err, http: res.status }
    }
    const data = (parsed ?? {}) as { jobId?: string; status?: string }
    if (!data.jobId) return { ok: false, error: 'gateway returned no jobId', http: res.status }
    return { ok: true, jobId: data.jobId, status: 'pending', http: res.status }
  } catch (err) {
    const formatted = formatFetchError(err, url)
    // Server-side warn — grepable in Vercel logs without exposing the bearer.
    // Useful when the operator reports a chat failure but can't read the
    // browser-side error (e.g. a backgrounded poll that swallowed it).
    console.warn(`[gateway-jobs] enqueue failed: ${formatted}`)
    return { ok: false, error: formatted }
  } finally {
    clearTimeout(t)
  }
}

export interface JobStatusOpts {
  gatewayUrl:  string
  bearerToken: string
  jobId:       string
  userId?:     string
  timeoutMs?:  number
}

export type JobStatus = 'pending' | 'running' | 'done' | 'error'

/** Tool-use record forwarded from the gateway (matches services/claude-gateway
 *  /src/spawn.ts::ToolCallRecord). Phase 2b of task_plan-chat.md. */
export interface ToolCall {
  id:          string
  name:        string
  input:       unknown
  output?:     unknown
  isError?:    boolean
  startedAt:   number
  finishedAt?: number
}

export interface JobStatusResult {
  ok:         boolean
  status?:    JobStatus
  /** Final assistant text once status === 'done'. */
  text?:      string
  /** Phase 2a — partial assistant text accumulated while pending/running.
   *  Clients render this as a tentative bubble between polls. */
  partialText?: string
  /** Tool calls observed during the turn (Phase 2b — chat renders as cards). */
  toolCalls?: ToolCall[]
  /** Phase 3 — tool calls observed SO FAR while the job is still running.
   *  Includes in-flight calls (startedAt set, finishedAt undefined) plus
   *  finished ones. SSE bridges diff this snapshot per tick to emit
   *  `tool_event` deltas; the final `toolCalls` array on done is a
   *  superset (and matches when the run completes cleanly). Optional
   *  because older gateway images (pre-Phase-3 deploy) don't emit it. */
  partialToolCalls?: ToolCall[]
  /** Native CLI error when status === 'error'. */
  jobError?:  string
  durationMs?: number
  /** Token usage emitted by the CLI's terminal `result` event. Forwarded so
   *  `recordCompletedTurnAccounting` can persist input/output token counts
   *  to `gateway_turns` — substrate for the G1 cost-measurement spike and
   *  for the plan-window math to work with real numbers, not nulls. */
  usage?: {
    input_tokens?:                number
    output_tokens?:               number
    cache_read_input_tokens?:     number
    cache_creation_input_tokens?: number
  }
  createdAt?:  number
  startedAt?:  number
  finishedAt?: number
  /** Transport-level error (couldn't reach gateway / 4xx). */
  error?:     string
  http?:      number
}

export async function getGatewayJob(opts: JobStatusOpts): Promise<JobStatusResult> {
  const base = opts.gatewayUrl.replace(/\/$/, '')
  const url  = `${base}/api/jobs/${encodeURIComponent(opts.jobId)}`
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${opts.bearerToken}`,
  }
  if (opts.userId) headers['X-Nexus-User-Id'] = opts.userId

  const ac = new AbortController()
  const t  = setTimeout(() => ac.abort(), opts.timeoutMs ?? 10_000)
  try {
    const res = await fetchAllowSelfSigned(url, { headers, signal: ac.signal })
    let parsed: unknown = null
    try { parsed = await res.json() } catch { /* leave null */ }
    if (!res.ok) {
      const err = (parsed && typeof parsed === 'object' && 'error' in parsed)
        ? String((parsed as { error: unknown }).error)
        : `gateway ${res.status}`
      return { ok: false, error: err, http: res.status }
    }
    const data = (parsed ?? {}) as {
      status?:    JobStatus
      result?:    {
        ok?:         boolean
        content?:    string
        error?:      string
        durationMs?: number
        toolCalls?:  ToolCall[]
        usage?:      JobStatusResult['usage']
      }
      partialText?:      string
      partialToolCalls?: ToolCall[]
      createdAt?:  number
      startedAt?:  number
      finishedAt?: number
    }
    return {
      ok:               true,
      status:           data.status,
      text:             data.result?.content,
      partialText:      data.partialText,
      partialToolCalls: data.partialToolCalls,
      toolCalls:        data.result?.toolCalls,
      jobError:         data.result?.ok === false ? data.result.error ?? 'job_failed' : undefined,
      durationMs:       data.result?.durationMs,
      usage:            data.result?.usage,
      createdAt:        data.createdAt,
      startedAt:        data.startedAt,
      finishedAt:       data.finishedAt,
      http:             res.status,
    }
  } catch (err) {
    const formatted = formatFetchError(err, url)
    // Don't console.warn the poll-side failure — pollers tick every 2.5s and
    // would flood logs while a gateway is down. The enqueue-side warn is
    // enough to surface "the gateway is unreachable" once.
    return { ok: false, error: formatted }
  } finally {
    clearTimeout(t)
  }
}
