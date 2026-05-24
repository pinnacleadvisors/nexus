/**
 * POST /api/admin/seed-deferred-tasks
 *
 * One-click path for the operator to populate `operator_tasks` with the
 * deferred-audit backlog from `lib/backlog/deferred-tasks.json` — no CLI,
 * no Doppler run. The /inbox empty-state banner calls this when the
 * operator clicks "Populate backlog".
 *
 * Same effect as `npm run seed:deferred-tasks` but via the operator's
 * Clerk session (so the user_id is auto-resolved — they don't need to
 * paste it from the Clerk dashboard).
 *
 * Idempotent: rows where (user_id, scope='admin', title) already exist
 * are preserved (done state intact). Re-runnable safely.
 *
 * Auth: Clerk + ALLOWED_USER_IDS — same gate as every other admin route.
 * Rate-limit: 3 per minute (this should rarely be hit).
 *
 * Returns 200 always (retry-storm safe) — `ok: true|false` carries the
 * signal so a transient DB blip doesn't trigger automatic retries from
 * any future poller.
 *
 * GET on the same path returns a dry-run preview (counts + sample titles)
 * without mutating, so the empty-state banner can show "20 tasks ready
 * to seed" before the operator clicks.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createServerClient } from '@/lib/supabase'
import { DEFERRED_TASKS, seedDeferredTasks } from '@/lib/backlog/deferred-tasks'

export const runtime     = 'nodejs'
export const maxDuration = 30

function inAllowedUserIds(userId: string): boolean {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return true // dev mode — allow all authenticated users
  return raw.split(',').map(s => s.trim()).includes(userId)
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'admin:seed-deferred:get' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId)                        return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  if (!inAllowedUserIds(session.userId))      return NextResponse.json({ ok: false, error: 'forbidden' },    { status: 403 })

  // How many of these are already present? Cheap count query.
  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase unavailable' })

  const titles = DEFERRED_TASKS.map(t => t.title)
  const res = await ((db.from('operator_tasks') as unknown as {
    select: (c: string, opts: { count: 'exact'; head: true }) => {
      eq:  (c: string, v: string) => {
        eq:  (c: string, v: string) => {
          in: (c: string, vals: string[]) => Promise<{ count: number | null; error: { message: string } | null }>
        }
      }
    }
  })
    .select('id', { count: 'exact', head: true })
    .eq('user_id', session.userId)
    .eq('scope',   'admin')
    .in('title',   titles))

  const alreadyPresent = res.count ?? 0
  const wouldSeed      = DEFERRED_TASKS.length - alreadyPresent

  return NextResponse.json({
    ok:              true,
    total:           DEFERRED_TASKS.length,
    already_present: alreadyPresent,
    would_seed:      wouldSeed,
    /** Optional preview — first 5 titles so the banner can show a sample. */
    sample_titles:   DEFERRED_TASKS.slice(0, 5).map(t => t.title),
  })
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 3, window: '1 m', prefix: 'admin:seed-deferred:post' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId)                   return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  if (!inAllowedUserIds(session.userId)) return NextResponse.json({ ok: false, error: 'forbidden' },    { status: 403 })

  const db = createServerClient()
  if (!db) {
    return NextResponse.json({ ok: false, error: 'supabase unavailable' })
  }

  try {
    const result = await seedDeferredTasks(db as unknown as { from: (t: string) => unknown }, session.userId)
    return NextResponse.json({
      ok:       true,
      upserted: result.upserted,
      skipped:  result.skipped,
      failed:   result.failed,
      /** Per-row detail — useful for the banner's "X new tasks added" toast. */
      details:  result.details,
    })
  } catch (err) {
    // 200 + ok:false — retry-storm safe.
    return NextResponse.json({
      ok:    false,
      error: 'seed_failed',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
}
