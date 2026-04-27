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
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':       'application/json',
        'Authorization':      `Bearer ${opts.bearerToken}`,
        'X-Nexus-Signature':  sign(body, opts.bearerToken),
        'X-Nexus-Timestamp':  Date.now().toString(),
      },
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
