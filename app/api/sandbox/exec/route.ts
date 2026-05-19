/**
 * POST /api/sandbox/exec
 *
 * Thin Nexus-side proxy to the rootless-Podman sandbox service. Handles auth,
 * cost-guard accounting, and the retry-storm 200-on-soft-failure rule before
 * forwarding to `nexus-sandbox`.
 *
 * Used by:
 *   - The `skill-trainer` managed agent (closed upskilling loop)
 *   - Any future "execute candidate code" workflow
 *
 * Body forwards to nexus-sandbox unchanged:
 *   { script, image?, timeout_ms?, network?, env? }
 *
 * Response shapes:
 *   200 { ok: true,  ... }     — sandbox ran successfully
 *   200 { ok: false, error }   — sandbox unreachable / cap exceeded / bad input
 *                                (200 per retry-storm rule — callers should
 *                                 read `ok` rather than HTTP status)
 *   401                        — unauthenticated
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { authenticateOps } from '@/lib/auth/ops-auth'
import { assertUnderCostCap } from '@/lib/cost-guard'

export const runtime    = 'nodejs'
export const maxDuration = 60

// Placeholder per-exec cost — refined when we have real telemetry. Each
// sandbox exec consumes some host CPU/RAM but no LLM tokens; the $0.001
// floor lets the per-day cap catch a runaway training loop without
// over-charging single one-offs.
const SANDBOX_COST_USD = Number(process.env.NEXUS_SANDBOX_COST_USD ?? 0.001)

interface ExecBody {
  script?:     string
  image?:      string
  timeout_ms?: number
  network?:    'none' | 'host'
  env?:        Record<string, string>
}

export async function POST(req: NextRequest) {
  // Two-mode auth — Clerk session (skill-trainer running interactively) OR
  // Bearer NEXUS_OPS_TOKEN (scripts, agents, GHA).
  let userId: string | null = null
  const session = await auth().catch(() => null)
  if (session?.userId) {
    userId = session.userId
  } else {
    const a = await authenticateOps(req, {})
    if ('response' in a) return a.response
    userId = a.userId
  }

  const cap = await assertUnderCostCap(userId)
  if (!cap.ok) {
    return NextResponse.json(
      { ok: false, error: 'daily cost cap exceeded', spentUsd: cap.spentUsd, capUsd: cap.capUsd },
      { status: 200 },
    )
  }

  let body: ExecBody = {}
  try { body = await req.json() as ExecBody } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 200 })
  }

  if (!body.script || typeof body.script !== 'string') {
    return NextResponse.json({ ok: false, error: 'script required' }, { status: 200 })
  }

  const sandboxUrl   = process.env.NEXUS_SANDBOX_URL
  const sandboxToken = process.env.NEXUS_SANDBOX_TOKEN
  if (!sandboxUrl || !sandboxToken) {
    return NextResponse.json(
      { ok: false, error: 'NEXUS_SANDBOX_URL or NEXUS_SANDBOX_TOKEN not configured' },
      { status: 200 },
    )
  }

  try {
    const res = await fetch(`${sandboxUrl.replace(/\/$/, '')}/exec`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${sandboxToken}`,
      },
      body:   JSON.stringify(body),
      signal: AbortSignal.timeout(65_000),
    })

    const text = await res.text()
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 1024) } }

    // Best-effort cost-guard accounting — fire-and-forget log to token_events.
    // We don't block the response on this; failure to log is non-fatal.
    Promise.resolve().then(async () => {
      try {
        const { createServerClient } = await import('@/lib/supabase')
        const db = createServerClient()
        if (db && userId) {
          await db.from('token_events').insert({
            user_id:       userId,
            model:         'nexus-sandbox',
            input_tokens:  0,
            output_tokens: 0,
            cost_usd:      SANDBOX_COST_USD,
          })
        }
      } catch { /* non-fatal */ }
    })

    return NextResponse.json(parsed, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'sandbox call failed'
    return NextResponse.json({ ok: false, error: message }, { status: 200 })
  }
}
