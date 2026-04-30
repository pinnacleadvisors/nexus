/**
 * HMAC verification for inbound webhooks (the Vercel cron pings us) and
 * signing for outbound calls (we hit `/api/admin/issue-bot-session` and the
 * gateway's signed endpoints with the same shape).
 *
 * Same on-the-wire format as `services/claude-gateway/src/auth.ts`:
 *   X-Nexus-Signature: sha256=<hex of HMAC-SHA256(body, secret)>
 *   X-Nexus-Timestamp: <ms epoch>
 *
 * 5-minute drift window. Constant-time compare on every check.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

const MAX_AGE_MS = 5 * 60 * 1000

export interface VerifyOpts {
  bodyText:  string
  signature: string | null | undefined
  timestamp: string | null | undefined
  secret:    string
}

export function verifySignature(opts: VerifyOpts): { ok: true } | { ok: false; reason: string } {
  if (!opts.signature) return { ok: false, reason: 'missing_signature' }
  if (!opts.timestamp) return { ok: false, reason: 'missing_timestamp' }
  const ts = Number.parseInt(opts.timestamp, 10)
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_AGE_MS) {
    return { ok: false, reason: 'stale_timestamp' }
  }
  const expected = 'sha256=' + createHmac('sha256', opts.secret).update(opts.bodyText).digest('hex')
  const a = Buffer.from(opts.signature, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' }
  }
  return { ok: true }
}

export function signBody(bodyText: string, secret: string): { signature: string; timestamp: string } {
  const timestamp = Date.now().toString()
  const signature = 'sha256=' + createHmac('sha256', secret).update(bodyText).digest('hex')
  return { signature, timestamp }
}
