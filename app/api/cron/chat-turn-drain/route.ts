/**
 * POST /api/cron/chat-turn-drain — durable chat reconciler (migration 099).
 *
 * Drains finished detached gateway jobs into chat_messages with no browser, so
 * a chat turn's reply survives the tab/app closing. Runs every ~2 min (cron-
 * job.org, titled `Nexus: chat-turn-drain`) AND is fire-and-forget kicked from
 * the platform-chat enqueue path so the common case drains in seconds.
 *
 * Auth: `CRON_SECRET` bearer, or the owner's Clerk session for a manual run.
 * Returns 200 even on failure (cron-route rule — a 5xx would get the job
 * auto-disabled by cron-job.org after repeated failures).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { reconcileInflightTurns } from '@/lib/chat/reconcile-inflight'

export const runtime = 'nodejs'
export const maxDuration = 60

function isCronAuthed(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`
}

export async function POST(req: NextRequest) {
  let authed = isCronAuthed(req)
  if (!authed) {
    const a = await auth()
    authed = Boolean(a.userId)
  }
  if (!authed) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  try {
    const result = await reconcileInflightTurns()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'reconcile failed' })
  }
}

export const GET = POST
