/**
 * POST /api/background-tasks/<id>/dispatch
 *
 * Drives a single background task pending → running → done|error. Owner-only.
 * Phase 4 v2 of task_plan-collaborative-chat.md.
 *
 * Flow:
 *   1. Auth via Clerk OR bot bearer (for fire-and-forget dispatches from
 *      persist-completed-turn after a chat turn).
 *   2. Load the row + verify owner.
 *   3. If status != 'pending', return 409 (idempotent — already running or
 *      already finished, don't double-fire).
 *   4. Mark running.
 *   5. Look up the kind's handler. Unknown kind → mark error "not yet
 *      implemented" and return 200 with the row.
 *   6. Run the handler with a hard 60s timeout.
 *   7. On success → mark done with the handler's result; on error → mark
 *      error with the message. Either way return 200 with the final row.
 *
 * Why a single-row endpoint vs a batch dispatcher: keeps each invocation's
 * runtime bounded (one task per Vercel function call), and makes the
 * fire-and-forget pattern from persist-completed-turn trivially safe —
 * we always know what task we're targeting.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import {
  getBackgroundTask,
  markBackgroundTaskRunning,
  markBackgroundTaskDone,
  markBackgroundTaskError,
} from '@/lib/background-tasks/dispatch'
import { getHandler } from '@/lib/background-tasks/handlers'
import { authBotToken } from '@/lib/auth/bot'

export const runtime = 'nodejs'
export const maxDuration = 90  // 60s handler timeout + 30s slack for slow upstreams

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await auth()
  // authBotToken returns the bot user id when the bearer matches BOT_API_TOKEN,
  // null otherwise — so we get the right userId for fire-and-forget dispatches
  // from persist-completed-turn (which uses the bot bearer).
  const userId = session.userId ?? authBotToken(req)
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ ok: false, error: 'missing_id' }, { status: 400 })

  const task = await getBackgroundTask(userId, id)
  if (!task) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  if (task.status !== 'pending') {
    // Idempotent — caller can safely retry without double-firing.
    return NextResponse.json({ ok: true, alreadyDispatched: true, task })
  }

  // Mark running BEFORE the handler so concurrent dispatch calls see the
  // new state. If the handler crashes mid-flight, the row stays 'running'
  // forever — Phase 4 v3 will add a stalled-task recovery cron.
  await markBackgroundTaskRunning(userId, id)

  const handler = getHandler(task.kind)
  if (!handler) {
    const updated = await markBackgroundTaskError(
      userId,
      id,
      `kind '${task.kind}' has no handler yet — see lib/background-tasks/handlers.ts HANDLERS map`,
    )
    return NextResponse.json({ ok: true, task: updated })
  }

  try {
    const { result } = await Promise.race([
      handler(task),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('handler_timeout: 60s exceeded')), 60_000),
      ),
    ])
    const updated = await markBackgroundTaskDone(userId, id, result)
    return NextResponse.json({ ok: true, task: updated })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const updated = await markBackgroundTaskError(userId, id, message)
    return NextResponse.json({ ok: true, task: updated, error: message })
  }
}
