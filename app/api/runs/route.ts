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

  const run = await startRun({
    userId:    g.userId,
    ideaId:    body.ideaId,
    projectId: body.projectId,
    cursor:    body.cursor,
  })
  if (!run) {
    // Supabase unconfigured → run is ephemeral (workflow generation still works,
    // it just won't be persisted). Return 200 with null so clients can detect
    // degraded mode without triggering a console error on 503.
    return NextResponse.json({
      run: null,
      ephemeral: true,
      reason: isSupabaseConfigured() ? 'insert_failed' : 'supabase_unconfigured',
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
