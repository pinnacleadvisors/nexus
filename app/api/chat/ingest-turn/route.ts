import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { authenticateOps } from '@/lib/auth/ops-auth'
import { persistCompletedTurn } from '@/lib/chat/persist-completed-turn'
import { createSession, getSession } from '@/lib/chat/sessions'

// Chat-engine-replacement P2 (ADR 013): re-home typed-block parsing. An external
// agent engine (claudecodeui driving Claude Code) POSTs each completed turn here;
// we run the SAME parseTurnBlocks() + persistCompletedTurn() the bespoke poll route
// used, so manual-task / approval-request / etc. flow into the governance views
// (Tasks / Approvals / Inbox) regardless of which engine produced the turn.
//
// Auth: bearer NEXUS_OPS_TOKEN (the Stop hook carries it) or an owner Clerk session.
// Called by a hook (not an auto-retrying service) — soft-fail 200 on transient errors.

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const auth = await authenticateOps(req)
  if ('response' in auth) return auth.response

  let body: {
    gatewayText?: string
    sessionId?: string
    jobId?: string
    scope?: string
    sessionTitle?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 200 })
  }

  const gatewayText = (body.gatewayText ?? '').trim()
  if (!gatewayText) return NextResponse.json({ ok: false, error: 'gatewayText required' }, { status: 200 })

  const scope = body.scope?.trim() || 'platform'
  const taskScope = scope === 'platform' ? 'admin' : scope.replace(/^platform$/, 'admin')

  try {
    // Resolve (or create) the session this turn belongs to.
    let sessionId = body.sessionId?.trim()
    if (sessionId) {
      const existing = await getSession(auth.userId, sessionId)
      if (!existing) sessionId = undefined
    }
    if (!sessionId) {
      const created = await createSession({
        userId: auth.userId,
        scope,
        agentSlug: 'claudecodeui',
        title: body.sessionTitle ?? 'Code session',
      })
      if (!created) return NextResponse.json({ ok: false, error: 'session create failed' }, { status: 200 })
      sessionId = created.id
    }

    const persisted = await persistCompletedTurn({
      userId: auth.userId,
      sessionId,
      jobId: body.jobId?.trim() || `ingest-${randomUUID()}`,
      gatewayText,
      taskScope,
      sessionTagFallback: 'claudecodeui',
    })

    return NextResponse.json({ ok: true, sessionId, ...persisted })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 200 })
  }
}
