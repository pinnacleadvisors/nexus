/**
 * POST /api/bug-hunt — start a new bug-hunt session.
 *
 * Body:
 *   {
 *     scope:                   'admin',                     // only admin in v1
 *     plan_window_share_pct?:  number = 33,
 *     codex_window_share_pct?: number = 33,
 *     force_plan_window?:      boolean = true,
 *     budget_usd?:             number = 5,
 *     max_iterations?:         number = 20,
 *   }
 *
 * Refuses with HTTP 409 if `force_plan_window=true` AND the current
 * routing would NOT use the Claude Max plan (e.g. all that exists is
 * `ANTHROPIC_API_KEY`). The operator must explicitly opt into API
 * billing by passing `force_plan_window=false`.
 *
 * Also refuses with HTTP 409 if an active session already exists for
 * (user, scope) — pause/stop the existing one first.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createSession, getActiveSession } from '@/lib/bug-hunt/sessions'
import { resolveClaudeCodeConfig } from '@/lib/claw/business-client'

export const runtime    = 'nodejs'
export const maxDuration = 10

interface Body {
  scope?:                  string
  plan_window_share_pct?:  number
  codex_window_share_pct?: number
  force_plan_window?:      boolean
  budget_usd?:             number
  max_iterations?:         number
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 6, window: '1 m', prefix: 'bug-hunt:start' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: Body = {}
  try { body = await req.json() } catch { /* validate below */ }
  const scope = body.scope ?? 'admin'
  if (scope !== 'admin') {
    // v1 only supports admin-scope loop. Per-business is a follow-up.
    return NextResponse.json({ ok: false, error: 'only admin scope is supported in v1' }, { status: 400 })
  }

  const forcePlanWindow = body.force_plan_window !== false
  if (forcePlanWindow) {
    // Refuse to start if routing would fall through to API billing.
    const cfg = await resolveClaudeCodeConfig(session.userId)
    if (!cfg) {
      return NextResponse.json({
        ok:    false,
        error: 'force_plan_window=true but no Claude Max gateway is reachable (resolveClaudeCodeConfig returned null). Either configure CLAUDE_CODE_GATEWAY_URL + CLAUDE_CODE_BEARER_TOKEN, or pass force_plan_window=false to allow API-billed fallback.',
        code:  'no_plan_window_route',
      }, { status: 409 })
    }
  }

  const existing = await getActiveSession(session.userId, scope)
  if (existing) {
    return NextResponse.json({
      ok:    false,
      error: `an active bug-hunt session already exists (${existing.id}). Pause or stop it before starting a new one.`,
      code:  'session_exists',
      existing_session_id: existing.id,
    }, { status: 409 })
  }

  const created = await createSession({
    userId:                 session.userId,
    scope,
    planWindowSharePct:     body.plan_window_share_pct,
    codexWindowSharePct:    body.codex_window_share_pct,
    forcePlanWindow,
    budgetUsd:              body.budget_usd,
    maxIterations:          body.max_iterations,
  })
  if (!created) return NextResponse.json({ ok: false, error: 'failed to create session' }, { status: 500 })
  return NextResponse.json({ ok: true, session: created })
}
