/**
 * POST /api/ecosystems/invoke — generic adapter dispatch surface.
 *
 * Body:
 *   { kind, name, verb, payload? }
 *
 * Resolves the registered adapter and forwards verb+payload. Returns the
 * adapter's typed EcosystemResult envelope directly (caller treats `ok: false`
 * + `error` as the failure shape).
 *
 * This is the public surface the memory-hq MCP server's `ecosystem_invoke`
 * tool calls into — exposes every adapter (video, code, design, search,
 * memory, etc.) to any agent without each agent needing to import the
 * registry. Stays auth-gated so a misbehaving agent can't burn the budget
 * by spamming render_clip; the operator's Clerk session is required, OR
 * an admin token for service-to-service calls.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { getEcosystem } from '@/lib/ecosystems/registry'
import type { EcosystemKind, EcosystemResult } from '@/lib/ecosystems/types'

export const runtime     = 'nodejs'
export const maxDuration = 60

interface InvokeBody {
  kind?:    string
  name?:    string
  verb?:    string
  payload?: unknown
}

const VALID_KINDS: readonly EcosystemKind[] = [
  'llm', 'code', 'design', 'video', 'image', 'voice', 'music', 'avatar',
  'speech', 'memory', 'search', 'browser', 'workflow', 'voice-agent', 'doc-parse',
]

export async function POST(req: NextRequest): Promise<NextResponse<EcosystemResult | { ok: false; error: string }>> {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'ecosystems:invoke' })
  if (!rl.success) return rateLimitResponse(rl) as NextResponse<EcosystemResult | { ok: false; error: string }>

  // Two auth paths: Clerk session OR an admin bearer that matches the
  // memory-hq MCP server's token (so the MCP server can forward agent
  // calls without forging a Clerk session).
  const session = await auth()
  const isClerk = Boolean(session.userId)
  const isAdmin = checkAdminBearer(req)
  if (!isClerk && !isAdmin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: InvokeBody = {}
  try { body = await req.json() } catch { /* validated below */ }
  if (!body.kind || !body.name || !body.verb) {
    return NextResponse.json({ ok: false, error: 'kind, name, verb required in body' }, { status: 400 })
  }
  if (!VALID_KINDS.includes(body.kind as EcosystemKind)) {
    return NextResponse.json({ ok: false, error: `invalid kind (must be one of ${VALID_KINDS.join(', ')})` }, { status: 400 })
  }

  const adapter = getEcosystem(body.kind as EcosystemKind, body.name)
  if (!adapter) {
    return NextResponse.json({
      ok:    false,
      error: `no adapter registered for ${body.kind}:${body.name}`,
    }, { status: 200 })  // 200 + ok:false: caller treats as missing capability, not server error
  }

  const result = await adapter.invoke(body.verb, body.payload)
  return NextResponse.json(result, { status: 200 })
}

/** Admin bearer check — service-to-service path. Accepts MEMORY_HQ_TOKEN
 *  (already used by the MCP server) so existing wiring works without a
 *  new env var. */
function checkAdminBearer(req: NextRequest): boolean {
  const hdr = req.headers.get('authorization') ?? ''
  if (!hdr.startsWith('Bearer ')) return false
  const tok = hdr.slice('Bearer '.length).trim()
  const allow = (process.env.MEMORY_HQ_TOKEN ?? '').trim()
  return tok.length > 0 && tok === allow
}
