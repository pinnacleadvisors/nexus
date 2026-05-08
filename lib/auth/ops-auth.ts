/**
 * Ops-endpoint authentication helper.
 *
 * Two modes, either is sufficient:
 *
 *   1. **Clerk session** (interactive use from the dashboard) — gated by the
 *      `ALLOWED_USER_IDS` owner allowlist via the existing /proxy.ts
 *      middleware. The route just needs a userId.
 *
 *   2. **Bearer token** (curl, scripts, GitHub Actions) — request carries
 *      `Authorization: Bearer <NEXUS_OPS_TOKEN>`. Operator-scope token,
 *      stored in Doppler. When this path authenticates, we pick a userId
 *      from the body (`{ userId: 'user_…' }`) or fall back to the first
 *      entry in `ALLOWED_USER_IDS` so writes to per-user tables (like
 *      user_secrets via setSecret) have a sensible default owner.
 *
 * Used by API routes that perform owner-only ops actions (provisioning,
 * sweeps, kill switches). The pattern mirrors /api/composio/doppler.
 *
 * Required env (mode 2 only):
 *   NEXUS_OPS_TOKEN     — long random hex, generated once. Set in Doppler.
 *   ALLOWED_USER_IDS    — comma-separated Clerk user ids (already set;
 *                         used to resolve the default owner under bearer).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth as clerkAuth } from '@clerk/nextjs/server'

export type OpsAuthOk = {
  mode:    'clerk' | 'bearer'
  userId:  string
  /** Free-form principal id for audit_log. */
  principal: string
}
export type OpsAuthFail = { response: NextResponse }

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function getAllowedUserIds(): string[] {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return []
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * Authenticate an ops-endpoint request. Optionally accepts a `bodyUserId`
 * (for routes that take a userId field on POST) so bearer-mode can target
 * a specific user instead of the default owner.
 */
export async function authenticateOps(
  req: NextRequest,
  opts: { bodyUserId?: string } = {},
): Promise<OpsAuthOk | OpsAuthFail> {
  // Mode 2 — bearer token (curl / scripts)
  const header = req.headers.get('authorization')
  if (header?.toLowerCase().startsWith('bearer ')) {
    const presented = header.slice(7).trim()
    const expected  = process.env.NEXUS_OPS_TOKEN
    if (!expected) {
      return { response: NextResponse.json({ error: 'NEXUS_OPS_TOKEN not configured on server' }, { status: 503 }) }
    }
    if (!timingSafeEqual(presented, expected)) {
      return { response: NextResponse.json({ error: 'invalid bearer token' }, { status: 401 }) }
    }
    const allowed = getAllowedUserIds()
    const userId  = opts.bodyUserId || allowed[0]
    if (!userId) {
      return { response: NextResponse.json({ error: 'no userId — set ALLOWED_USER_IDS or pass userId in body' }, { status: 400 }) }
    }
    if (opts.bodyUserId && allowed.length > 0 && !allowed.includes(opts.bodyUserId)) {
      return { response: NextResponse.json({ error: 'bodyUserId not in ALLOWED_USER_IDS' }, { status: 403 }) }
    }
    return { mode: 'bearer', userId, principal: 'ops-bearer' }
  }

  // Mode 1 — Clerk session (interactive)
  const session = await clerkAuth()
  if (!session.userId) {
    return { response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  }
  const allowed = getAllowedUserIds()
  if (allowed.length > 0 && !allowed.includes(session.userId)) {
    return { response: NextResponse.json({ error: 'owner only' }, { status: 403 }) }
  }
  return { mode: 'clerk', userId: session.userId, principal: session.userId }
}
