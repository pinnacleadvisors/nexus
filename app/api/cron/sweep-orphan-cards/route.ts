/**
 * POST/GET /api/cron/sweep-orphan-cards
 *
 * Nightly cron at 04:30 UTC (10 minutes after sync-memory). Soft-archives
 * orphan board cards then hard-deletes any whose archived_at is older than
 * the 7-day grace window. See lib/runs/orphan-sweeper.ts for policy.
 *
 * Auth: bearer CRON_SECRET (Vercel cron) OR Clerk owner session.
 *
 * Manual triggers:
 *   - `?dryRun=1` returns counts only, never mutates.
 *   - The "Clean orphans now" button on /manage-platform calls this with
 *     `?dryRun=1` first, then again without to commit.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { sweepOrphans } from '@/lib/runs/orphan-sweeper'
import { audit } from '@/lib/audit'

export const runtime = 'nodejs'
export const maxDuration = 60

function isCronAuthed(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const got = req.headers.get('authorization') ?? ''
  return got === `Bearer ${expected}`
}

async function requireOwnerOrCron(req: NextRequest): Promise<NextResponse | null> {
  if (isCronAuthed(req)) return null
  const a = await auth()
  if (!a.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const allowed = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (allowed.length > 0 && !allowed.includes(a.userId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return null
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const guard = await requireOwnerOrCron(req)
  if (guard) return guard

  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'

  try {
    const result = await sweepOrphans({ dryRun })
    audit(req, {
      action: dryRun ? 'orphan-sweep.preview' : 'orphan-sweep.run',
      resource: 'tasks',
      metadata: result as unknown as Record<string, unknown>,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export const POST = handle
export const GET = handle
