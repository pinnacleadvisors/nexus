/**
 * POST /api/background-tasks/<id>/cancel
 *
 * Marks a background task cancelled. Owner-only. Phase 4 of
 * task_plan-collaborative-chat.md.
 *
 * v1: idempotent — calling on an already-cancelled / done / error row
 * is a no-op that returns the current state. The actual Inngest cancel
 * signal (when v2 wires execution) will be fired from inside
 * cancelBackgroundTask() in the same call.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { cancelBackgroundTask } from '@/lib/background-tasks/dispatch'

export const runtime = 'nodejs'
export const maxDuration = 10

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ ok: false, error: 'missing_id' }, { status: 400 })
  const row = await cancelBackgroundTask(session.userId, id)
  if (!row) return NextResponse.json({ ok: false, error: 'not_found_or_already_cancelled' }, { status: 404 })
  return NextResponse.json({ ok: true, task: row })
}
