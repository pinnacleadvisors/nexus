/**
 * Minimal HMAC-signed call to the Claude Code gateway (or any service that
 * speaks the same `POST /api/sessions/:id/messages` protocol).
 *
 * The protocol is identical to what dispatchToOpenClaw uses in
 * app/api/claude-session/dispatch/route.ts — extracted here so /api/chat and
 * any future caller can route a one-off prompt to the gateway without
 * duplicating signature logic. OpenClaw bearer-only callers are NOT migrated
 * — they remain on the legacy unsigned path so this helper does not silently
 * change their request shape.
 */

import { createHmac } from 'node:crypto'

export interface GatewayCallOpts {
  gatewayUrl:    string
  bearerToken:   string
  /** Used in the URL path; forge / chat / agent slugs are all valid. */
  sessionTag:    string
  /** Free-text prompt to send to Claude. */
  message:       string
  /** Agent slug — when set, the gateway loads .claude/agents/<slug>.md as system prompt. */
  agentSlug?:    string | null
  /** Per-request env overrides forwarded to the spawned claude CLI. */
  env?:          Record<string, string>
  /** Default 55 s — must stay under Vercel maxDuration of 60 s. */
  timeoutMs?:    number
  /**
   * Clerk user ID of the originating session — sent as `X-Nexus-User-Id`.
   * The gateway enforces ALLOWED_USER_IDS against this header, so a bearer
   * leak alone can't be used to drain the Max plan from elsewhere.
   */
  userId?:       string
}

export interface GatewayCallResult {
  ok:        boolean
  text:      string
  status:    number
  error?:    string
  durationMs?: number
}

function sign(bodyText: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(bodyText).digest('hex')
}

export interface GatewayStreamCallbacks {
  onDelta?:  (text: string) => void
  onResult?: (data: { content: string; usage?: unknown; durationMs?: number }) => void
  onError?:  (err: { error: string; detail?: string }) => void
}

/**
 * Streams the gateway's `/api/sessions/:id/stream` SSE endpoint and invokes
 * the supplied callbacks per event. Resolves with the full assistant text
 * when the `result` event fires, or rejects on `error`.
 *
 * Use this from streaming routes (chat, agent, build/plan) once the gateway
 * has the streaming endpoint deployed. Falls through cleanly to the API-key
 * path if the gateway returns 404 (i.e. an old gateway image without the
 * stream route).
 */
export async function callGatewayStream(
  opts:      GatewayCallOpts,
  callbacks: GatewayStreamCallbacks,
): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  const base = opts.gatewayUrl.replace(/\/$/, '')
  const url  = `${base}/api/sessions/${encodeURIComponent(opts.sessionTag)}/stream`
  const body = JSON.stringify({
    role:    'user',
    content: opts.message,
    agent:   opts.agentSlug ?? null,
    env:     opts.env ?? {},
  })

  const headers: Record<string, string> = {
    'Content-Type':      'application/json',
    'Authorization':     `Bearer ${opts.bearerToken}`,
    'X-Nexus-Signature': sign(body, opts.bearerToken),
    'X-Nexus-Timestamp': Date.now().toString(),
    'Accept':            'text/event-stream',
  }
  if (opts.userId) headers['X-Nexus-User-Id'] = opts.userId

  const controller = new AbortController()
  const timeout    = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000)

  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal })
  } catch (err) {
    clearTimeout(timeout)
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
  }

  if (!res.ok || !res.body) {
    clearTimeout(timeout)
    const t = await res.text().catch(() => '')
    return { ok: false, status: res.status, error: t.slice(0, 200) || `gateway ${res.status}` }
  }

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)

        let eventName = 'message'
        let dataLine  = ''
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLine += line.slice(5).trim()
        }
        if (!dataLine) continue
        let parsed: Record<string, unknown> = {}
        try { parsed = JSON.parse(dataLine) } catch { continue }

        if (eventName === 'delta' && typeof parsed.text === 'string') {
          fullText += parsed.text
          callbacks.onDelta?.(parsed.text)
        } else if (eventName === 'result') {
          callbacks.onResult?.({
            content:    typeof parsed.content === 'string' ? parsed.content : fullText,
            usage:      parsed.usage,
            durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : undefined,
          })
        } else if (eventName === 'error') {
          callbacks.onError?.({
            error:  typeof parsed.error  === 'string' ? parsed.error  : 'unknown',
            detail: typeof parsed.detail === 'string' ? parsed.detail : undefined,
          })
          return { ok: false, status: 502, error: typeof parsed.error === 'string' ? parsed.error : 'gateway_error' }
        }
      }
    }
  } finally {
    clearTimeout(timeout)
  }

  return { ok: true, text: fullText }
}

export async function callGateway(opts: GatewayCallOpts): Promise<GatewayCallResult> {
  const base = opts.gatewayUrl.replace(/\/$/, '')
  const url  = `${base}/api/sessions/${encodeURIComponent(opts.sessionTag)}/messages`
  const body = JSON.stringify({
    role:    'user',
    content: opts.message,
    agent:   opts.agentSlug ?? null,
    env:     opts.env ?? {},
  })

  const controller = new AbortController()
  const timeout    = setTimeout(() => controller.abort(), opts.timeoutMs ?? 55_000)
  try {
    const headers: Record<string, string> = {
      'Content-Type':      'application/json',
      'Authorization':     `Bearer ${opts.bearerToken}`,
      'X-Nexus-Signature': sign(body, opts.bearerToken),
      'X-Nexus-Timestamp': Date.now().toString(),
    }
    if (opts.userId) headers['X-Nexus-User-Id'] = opts.userId

    const res = await fetch(url, {
      method:  'POST',
      headers,
      body,
      signal: controller.signal,
    })
    clearTimeout(timeout)

    let parsed: unknown = null
    try { parsed = await res.json() } catch { /* non-JSON body — leave null */ }

    if (!res.ok) {
      const errText =
        (parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error: unknown }).error === 'string')
          ? (parsed as { error: string }).error
          : `gateway ${res.status}`
      return { ok: false, text: '', status: res.status, error: errText }
    }

    const data = (parsed ?? {}) as { content?: string; text?: string; durationMs?: number }
    return {
      ok:         true,
      status:     res.status,
      text:       data.content ?? data.text ?? '',
      durationMs: data.durationMs,
    }
  } catch (err) {
    clearTimeout(timeout)
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok:     false,
      text:   '',
      status: 0,
      error:  msg.includes('abort') ? 'gateway request timed out' : msg,
    }
  }
}
