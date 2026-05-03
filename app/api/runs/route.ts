/**
 * /api/runs — Run state machine entrypoints.
 *
 * GET  /api/runs?phase=<phase>        — list caller's runs, newest first
 * POST /api/runs { ideaId?, projectId? } — start (or resume) a run for an idea
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { listRuns, startRun } from '@/lib/runs/controller'
import { audit } from '@/lib/audit'
import { isSupabaseConfigured } from '@/lib/supabase'
import type { RunPhase } from '@/lib/types'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'runs:list' },
  })
  if ('response' in g) return g.response

  const phase = (req.nextUrl.searchParams.get('phase') ?? undefined) as RunPhase | undefined
  const runs = await listRuns(g.userId, { phase })
  return NextResponse.json({ runs })
}

export async function POST(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 30, window: '1 m', prefix: 'runs:create' },
  })
  if ('response' in g) return g.response

  const body = await req.json().catch(() => ({})) as {
    ideaId?: string
    projectId?: string
    cursor?: Record<string, unknown>
  }

  // startRun returns null when Supabase is unconfigured; we also guard against
  // thrown errors (network blip, RLS denial, missing table) so a transient DB
  // failure degrades to ephemeral mode instead of surfacing a 503 in the
  // browser console — the caller already treats a null run as best-effort.
  let run: Awaited<ReturnType<typeof startRun>> = null
  let errorReason: string | undefined
  try {
    run = await startRun({
      userId:    g.userId,
      ideaId:    body.ideaId,
      projectId: body.projectId,
      cursor:    body.cursor,
    })
  } catch (err) {
    errorReason = err instanceof Error ? err.message : 'unknown_error'
    console.error('[api/runs] startRun threw:', err)
  }

  if (!run) {
    // F8 / S6 — make the ephemeral state visible to the UI. Same shape as
    // success but with severity + userMessage so client banners can show
    // "your Run wasn't persisted; fix Supabase before continuing."
    const reason = errorReason
      ? 'start_failed'
      : isSupabaseConfigured() ? 'insert_failed' : 'supabase_unconfigured'
    const userMessage = reason === 'supabase_unconfigured'
      ? 'Run started but not persisted — Supabase env vars are missing. Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to keep history across sessions.'
      : reason === 'insert_failed'
        ? 'Run started but the database refused the insert. Likely cause: missing migration or RLS denial. Check /manage-platform Health.'
        : `Run start failed: ${errorReason ?? 'unknown'}`
    return NextResponse.json({
      run: null,
      ephemeral: true,
      severity: 'warn',
      reason,
      userMessage,
      ...(errorReason ? { error: errorReason } : {}),
    })
  }

  audit(req, {
    action: 'run.start',
    resource: 'run',
    resourceId: run.id,
    userId: g.userId,
    metadata: { ideaId: run.ideaId, phase: run.phase },
  })

  return NextResponse.json({ run }, { status: 201 })
}
