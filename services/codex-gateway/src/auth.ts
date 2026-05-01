import { createHmac, timingSafeEqual } from 'node:crypto'

export interface VerifyArgs {
  bodyText:    string
  signature:   string | null
  bearer:      string | null
  sharedSecret: string
  /**
   * Maximum allowed clock skew, in ms. The signature header carries a
   * timestamp; requests older than this are rejected to limit replay attacks.
   * Mirrors the 5-minute window used by GitHub / Stripe webhooks.
   */
  timestampMs?: number
  /** Maximum age in ms (default 5 minutes). */
  maxAgeMs?:   number
}

export interface VerifyResult {
  ok:     boolean
  reason?: 'missing-bearer' | 'bad-bearer' | 'missing-signature' | 'bad-signature' | 'stale-timestamp'
}

export function verifyHmac(args: VerifyArgs): VerifyResult {
  const maxAge = args.maxAgeMs ?? 5 * 60 * 1000

  if (!args.bearer) return { ok: false, reason: 'missing-bearer' }
  // constant-time compare against the shared secret
  const a = Buffer.from(args.bearer)
  const b = Buffer.from(args.sharedSecret)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad-bearer' }
  }

  if (!args.signature) return { ok: false, reason: 'missing-signature' }

  if (args.timestampMs !== undefined) {
    const drift = Math.abs(Date.now() - args.timestampMs)
    if (Number.isNaN(args.timestampMs) || drift > maxAge) {
      return { ok: false, reason: 'stale-timestamp' }
    }
  }

  const expected = 'sha256=' + createHmac('sha256', args.sharedSecret)
    .update(args.bodyText)
    .digest('hex')

  const sigBuf = Buffer.from(args.signature)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: 'bad-signature' }
  }

  return { ok: true }
}
