/**
 * POST /api/cron/audit-prune
 *
 * Mission Control Kit Pack 03's 90-day retention. Deletes `audit_log` rows
 * older than 90 days where `pinned = false`. Owner-curated rows stay forever.
 *
 * Vercel cron daily at 06:00 UTC. The Vercel cron header `x-vercel-cron`
 * authenticates the platform-issued call; manual GET requires owner auth.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import { isEnabled as isKillSwitchEnabled } from '@/lib/kill-switches'

export const runtime = 'nodejs'

const RETENTION_DAYS = 90

function getAllowedUserIds(): Set<string> | null {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return null
  return new Set(raw.split(',').map(id => id.trim()).filter(Boolean))
}

async function isAuthorized(req: NextRequest): Promise<{ ok: true; via: string } | { ok: false; reason: string }> {
  // 1. Vercel platform cron — header is set on platform-issued calls only.
  if (req.headers.get('x-vercel-cron')) return { ok: true, via: 'vercel-cron' }
  // 2. Bearer token (CRON_SECRET) for self-issued external schedulers.
  const auth2 = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth2 === `Bearer ${cronSecret}`) return { ok: true, via: 'bearer' }
  // 3. Owner-only manual trigger.
  const { userId } = await auth()
  if (!userId) return { ok: false, reason: 'unauthorized' }
  const allowed = getAllowedUserIds()
  if (allowed && !allowed.has(userId)) return { ok: false, reason: 'owner only' }
  return { ok: true, via: 'owner' }
}

async function prune(): Promise<{ deleted: number }> {
  const db = createServerClient()
  if (!db) return { deleted: 0 }
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString()
  // `pinned` is from migration 030 — not yet in lib/database.types.ts.
  // Same escape hatch as lib/business/db.ts.
  type LooseDelete = {
    delete: (opts?: { count?: 'exact' }) => LooseDelete
    eq:     (k: string, v: unknown) => LooseDelete
    lt:     (k: string, v: unknown) => LooseDelete
    then:   <T>(onfulfilled: (v: { error: { message: string } | null; count: number | null }) => T) => Promise<T>
  }
  const { error, count } = await (db.from('audit_log' as never) as unknown as LooseDelete)
    .delete({ count: 'exact' })
    .eq('pinned', false)
    .lt('created_at', cutoff)
  if (error) return { deleted: 0 }
  return { deleted: count ?? 0 }
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const authz = await isAuthorized(req)
  if (!('via' in authz)) return NextResponse.json({ error: authz.reason }, { status: 401 })
  if (!(await isKillSwitchEnabled('scheduler'))) {
    return NextResponse.json({ skipped: 'scheduler kill switch disabled' }, { status: 200 })
  }
  const result = await prune()
  return NextResponse.json({ ok: true, retentionDays: RETENTION_DAYS, ...result })
}

export async function GET(req: NextRequest):  Promise<NextResponse> { return handle(req) }
export async function POST(req: NextRequest): Promise<NextResponse> { return handle(req) }
