/**
 * guardRequest — one-call combo of CSRF + auth + rate-limit + optional cost cap.
 *
 * Returns `{ userId }` on success, or `{ response }` with a ready 401/403/429/402
 * NextResponse on failure. Callers should `if ('response' in r) return r.response`
 * and otherwise continue with `r.userId`.
 *
 * This is a thin alternative to higher-order wrappers so existing handlers can
 * keep their body-parsing, streaming, and error-handling structure unchanged.
 *
 * Usage:
 *   const g = await guardRequest(req, { rateLimit: { limit: 20, window: '1 m', prefix: 'chat' } })
 *   if ('response' in g) return g.response
 *   const { userId } = g
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { checkCsrf } from '@/lib/csrf'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { assertUnderCostCap } from '@/lib/cost-guard'

export interface GuardOpts {
  /** Require Clerk auth. Default: true. */
  auth?: boolean
  /** Run CSRF origin check on mutating methods. Default: true. */
  csrf?: boolean
  /** Per-user or per-IP rate-limit bucket. */
  rateLimit?: { limit: number; window: string; prefix: string }
  /** Enforce the per-user daily USD cap before letting the call through. */
  costCap?: boolean
}

export type GuardResult =
  | { userId: string }
  | { response: NextResponse }

export async function guardRequest(req: NextRequest, opts: GuardOpts = {}): Promise<GuardResult> {
  // 1. CSRF first — cheapest check, no await
  if (opts.csrf !== false) {
    const csrfFail = checkCsrf(req)
    if (csrfFail) return { response: csrfFail }
  }

  // 2. Auth
  let userId: string | null = null
  if (opts.auth !== false) {
    const session = await auth()
    if (!session.userId) {
      return { response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
    }
    userId = session.userId
  }

  // 3. Rate limit
  if (opts.rateLimit) {
    const rl = await rateLimit(req, { ...opts.rateLimit, identifier: userId ?? undefined })
    if (!rl.success) return { response: rateLimitResponse(rl) }
  }

  // 4. Daily cost cap
  if (opts.costCap && userId) {
    const cap = await assertUnderCostCap(userId)
    if (!cap.ok) {
      return {
        response: NextResponse.json(
          { error: 'daily cost cap exceeded', spentUsd: cap.spentUsd, capUsd: cap.capUsd },
          { status: 402 },
        ),
      }
    }
  }

  return { userId: userId ?? '' }
}
