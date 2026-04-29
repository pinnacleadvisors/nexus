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

export async function enqueueGatewayJob(opts: EnqueueJobOpts): Promise<EnqueueJobResult> {
  const base = opts.gatewayUrl.replace(/\/$/, '')
  const url  = `${base}/api/jobs`
  const body = JSON.stringify({
    role:    'user',
    content: opts.message,
    agent:   opts.agentSlug ?? null,
    env:     opts.env ?? {},
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
    const res = await fetch(url, { method: 'POST', headers, body, signal: ac.signal })
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
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg.includes('abort') ? 'enqueue timed out' : msg }
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

export interface JobStatusResult {
  ok:         boolean
  status?:    JobStatus
  /** Final assistant text once status === 'done'. */
  text?:      string
  /** Native CLI error when status === 'error'. */
  jobError?:  string
  durationMs?: number
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
    const res = await fetch(url, { headers, signal: ac.signal })
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
      result?:    { ok?: boolean; content?: string; error?: string; durationMs?: number }
      createdAt?:  number
      startedAt?:  number
      finishedAt?: number
    }
    return {
      ok:          true,
      status:      data.status,
      text:        data.result?.content,
      jobError:    data.result?.ok === false ? data.result.error ?? 'job_failed' : undefined,
      durationMs:  data.result?.durationMs,
      createdAt:   data.createdAt,
      startedAt:   data.startedAt,
      finishedAt:  data.finishedAt,
      http:        res.status,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg.includes('abort') ? 'status request timed out' : msg }
  } finally {
    clearTimeout(t)
  }
}
