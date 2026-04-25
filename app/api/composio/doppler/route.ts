/**
 * POST /api/composio/doppler — Doppler secrets broker for Claude Code web sessions.
 *
 * Two auth modes (either is sufficient):
 *   1. Clerk session + ALLOWED_USER_IDS owner gate (interactive use from the dashboard).
 *   2. Bearer token matching `CLAUDE_SESSION_BROKER_TOKEN` (cloud sandbox use via
 *      a SessionStart hook).
 *
 * Body: { names: string[] }
 *   Each requested name is checked against `COMPOSIO_BROKER_ALLOWED_SECRETS`
 *   (comma-separated allowlist). Names outside the list are rejected silently
 *   so a leaked token can't be used to enumerate.
 *
 * Returns: { secrets: { NAME: VALUE }, missing: string[], rejected: string[] }
 *
 * Audit: every call writes an `audit_log` row with action `composio.doppler.read`,
 *        the requested names, and which auth mode was used. Values are NEVER
 *        logged.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { fetchDopplerSecrets, ComposioError } from '@/lib/composio'

export const runtime = 'nodejs'

function getAllowedUserIds(): Set<string> | null {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return null
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean))
}

function getAllowedSecrets(): Set<string> | null {
  const raw = process.env.COMPOSIO_BROKER_ALLOWED_SECRETS
  if (!raw?.trim()) return null
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean))
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

type AuthOk = { mode: 'clerk' | 'bearer'; principal: string }
type AuthFail = { response: NextResponse }

async function authenticate(req: NextRequest): Promise<AuthOk | AuthFail> {
  // Mode 2 — bearer token (cloud session)
  const header = req.headers.get('authorization')
  if (header?.toLowerCase().startsWith('bearer ')) {
    const presented = header.slice(7).trim()
    const expected = process.env.CLAUDE_SESSION_BROKER_TOKEN
    if (!expected) {
      return { response: NextResponse.json({ error: 'broker token not configured' }, { status: 503 }) }
    }
    if (!timingSafeEqual(presented, expected)) {
      return { response: NextResponse.json({ error: 'invalid bearer token' }, { status: 401 }) }
    }
    return { mode: 'bearer', principal: 'claude-session' }
  }

  // Mode 1 — Clerk session + owner allowlist
  const session = await auth()
  if (!session.userId) {
    return { response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  }
  const ownerSet = getAllowedUserIds()
  if (ownerSet && !ownerSet.has(session.userId)) {
    return { response: NextResponse.json({ error: 'owner only' }, { status: 403 }) }
  }
  return { mode: 'clerk', principal: session.userId }
}

export async function POST(req: NextRequest) {
  // Rate-limit by principal once we know it; pre-auth limit by IP keeps brute-force in check.
  const preRl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'composio:doppler:pre' })
  if (!preRl.success) return rateLimitResponse(preRl)

  const a = await authenticate(req)
  if ('response' in a) return a.response

  const rl = await rateLimit(req, {
    limit: 60,
    window: '1 m',
    prefix: `composio:doppler:${a.mode}`,
    identifier: a.principal,
  })
  if (!rl.success) return rateLimitResponse(rl)

  let body: { names?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.names) || body.names.length === 0) {
    return NextResponse.json({ error: 'names: non-empty string[] required' }, { status: 400 })
  }
  if (body.names.length > 50) {
    return NextResponse.json({ error: 'names: max 50 per request' }, { status: 400 })
  }
  const requested = body.names.filter((n): n is string => typeof n === 'string' && /^[A-Z0-9_]+$/.test(n))

  const allowSet = getAllowedSecrets()
  const allowed: string[] = []
  const rejected: string[] = []
  for (const name of requested) {
    if (!allowSet || allowSet.has(name)) allowed.push(name)
    else rejected.push(name)
  }

  let secrets: Record<string, string> = {}
  let missing: string[] = []
  if (allowed.length > 0) {
    try {
      secrets = await fetchDopplerSecrets(allowed)
    } catch (err) {
      const status = err instanceof ComposioError ? err.status : 500
      const message = err instanceof Error ? err.message : 'composio fetch failed'
      audit(req, {
        action: 'composio.doppler.read',
        resource: 'secrets',
        userId: a.mode === 'clerk' ? a.principal : undefined,
        metadata: { mode: a.mode, requested: allowed, error: message, status },
      })
      return NextResponse.json({ error: message }, { status: status >= 400 && status < 600 ? status : 502 })
    }
    missing = allowed.filter(n => !(n in secrets))
  }

  audit(req, {
    action: 'composio.doppler.read',
    resource: 'secrets',
    userId: a.mode === 'clerk' ? a.principal : undefined,
    metadata: {
      mode: a.mode,
      requested: allowed,
      missing,
      rejected,
      returnedCount: Object.keys(secrets).length,
    },
  })

  return NextResponse.json({ secrets, missing, rejected })
}
