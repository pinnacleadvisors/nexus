/**
 * POST /api/platform-chat/permission-requests/:id
 *
 * Operator's Allow / Deny click. The PermissionPromptCard in the chat
 * UI POSTs here. The broker MCP — which is currently polling this row
 * inside the claude-gateway — sees the status flip and returns the
 * decision back to the CLI on its next tick.
 *
 * Body:
 *   { allow: true,  updated_input?: object, reason?: string,
 *     remember_for_session?: boolean }     ← Allow
 *   { allow: false, reason?: string }      ← Deny
 *
 * Returns the resolved row so the chat UI can mark its card read-only
 * without re-fetching.
 *
 * Auth: Clerk. The decide helper does an extra user_id check on the
 * row so a leaked request id from another operator can't be hijacked.
 *
 * Idempotency: the helper's optimistic update only fires on rows still
 * in status='pending'. A stale tab posting a second decision is a no-op
 * (returns null → 409).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { decidePermissionRequest, type PermissionDecision } from '@/lib/chat/permission-requests'

export const runtime    = 'nodejs'
export const maxDuration = 10

interface Body {
  allow?:                 boolean
  updated_input?:         Record<string, unknown>
  reason?:                string
  remember_for_session?:  boolean
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(req, { limit: 40, window: '1 m', prefix: 'platform-chat:permission-decide' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) {
    return NextResponse.json({ ok: false, error: 'unauthorized', code: 'unauthorized' }, { status: 401 })
  }

  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid id', code: 'invalid' }, { status: 400 })
  }

  let body: Body
  try { body = (await req.json()) as Body } catch {
    return NextResponse.json({ ok: false, error: 'invalid json body', code: 'invalid' }, { status: 400 })
  }
  if (typeof body.allow !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'body.allow must be boolean', code: 'invalid' }, { status: 400 })
  }
  if (body.updated_input !== undefined && (body.updated_input === null || typeof body.updated_input !== 'object')) {
    return NextResponse.json({ ok: false, error: 'body.updated_input must be an object', code: 'invalid' }, { status: 400 })
  }

  const decision: PermissionDecision = {}
  if (body.reason)               decision.reason               = body.reason.slice(0, 1000)
  if (body.updated_input)        decision.updated_input        = body.updated_input
  if (body.remember_for_session) decision.remember_for_session = true

  const row = await decidePermissionRequest({
    id,
    userId:   session.userId,
    status:   body.allow ? 'allowed' : 'denied',
    decision: Object.keys(decision).length > 0 ? decision : undefined,
  })

  if (!row) {
    // Most likely: the row was already resolved by an earlier click, or
    // never existed under this user_id. Both surface as 409 so the UI
    // can refresh its pending list rather than show a generic error.
    return NextResponse.json({
      ok:    false,
      error: 'request not found or already resolved',
      code:  'conflict',
    }, { status: 409 })
  }

  return NextResponse.json({ ok: true, request: row })
}
