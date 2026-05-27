/**
 * POST /api/cron/agent-cache-evict — daily cron.
 *
 * Two-pass eviction for `agent_response_cache` (migration 090):
 *
 *   Pass 1 — TTL expiry:
 *     DELETE WHERE expires_at < now()
 *
 *   Pass 2 — LRU trim:
 *     If row count > MAX_ROWS (default 10000), delete the
 *     oldest-by-last_used_at down to 80% of the cap (8000) so the next
 *     cron tick doesn't fire again immediately.
 *
 * Operator brain-dump 2026-05-27: the cache.ts foundation referenced this
 * cron as "deferred to follow-up PR" — this is the follow-up.
 *
 * Retry-storm safe: 200 even on partial failure. Auth via CRON_SECRET
 * bearer OR vercel-cron header OR dev-mode bypass. Cron-job.org should
 * pick this up via the same auto-poll that surfaces other cron entries.
 *
 * cost: a single DELETE statement per pass — no LLM, no external calls.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_ROWS    = 10_000
const TRIM_TO     = 8_000  // After LRU trim, leave this many rows.

function isAuthorised(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (expected) {
    const header = req.headers.get('authorization') ?? ''
    if (header === `Bearer ${expected}`) return true
  }
  if (req.headers.get('vercel-cron') === '1') return true
  if (!expected && process.env.NODE_ENV !== 'production') return true
  return false
}

interface EvictResponse {
  ok:                boolean
  expired_deleted?:  number
  lru_deleted?:      number
  total_rows_after?: number
  error?:            string
}

export async function POST(req: NextRequest): Promise<NextResponse<EvictResponse>> {
  if (!isAuthorised(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  let expiredDeleted = 0
  let lruDeleted     = 0
  let totalRowsAfter = 0

  // Pass 1 — TTL expiry. Safe to run unconditionally even on an empty table.
  try {
    const nowIso = new Date().toISOString()
    const res = await (db.from('agent_response_cache' as never) as unknown as {
      delete: () => { lt: (c: string, v: string) => { select: (c: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }> } }
    }).delete().lt('expires_at', nowIso).select('input_hash')
    if (res.error) {
      // The table not existing means migration 090 hasn't applied yet —
      // surface that fact but stay 200 so cron-job.org doesn't auto-disable.
      if (/relation .*agent_response_cache.* does not exist/i.test(res.error.message)) {
        return NextResponse.json({ ok: false, error: 'migration_090_not_applied' })
      }
      return NextResponse.json({ ok: false, error: res.error.message })
    }
    expiredDeleted = (res.data ?? []).length
  } catch (err) {
    return NextResponse.json({
      ok:    false,
      error: err instanceof Error ? err.message : 'expiry_pass_failed',
    })
  }

  // Pass 2 — LRU trim. Count remaining rows; if over MAX_ROWS, delete the
  // oldest-by-last_used_at down to TRIM_TO. Two-step: select the IDs to
  // delete, then delete by ID. Supabase JS doesn't expose "delete with
  // limit + order" in one statement.
  try {
    const countRes = await (db.from('agent_response_cache' as never) as unknown as {
      select: (c: string, opts: { count: 'exact'; head: boolean }) => Promise<{ count: number | null; error: { message: string } | null }>
    }).select('*', { count: 'exact', head: true })
    if (countRes.error) {
      return NextResponse.json({
        ok:               true,
        expired_deleted:  expiredDeleted,
        lru_deleted:      0,
        error:            countRes.error.message,
      })
    }
    const totalRows = countRes.count ?? 0
    totalRowsAfter  = totalRows

    if (totalRows > MAX_ROWS) {
      const overflow = totalRows - TRIM_TO
      // Pick the `overflow` oldest rows by last_used_at.
      const oldestRes = await (db.from('agent_response_cache' as never) as unknown as {
        select: (c: string) => { order: (c: string, opts: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: Array<{ input_hash: string }> | null; error: { message: string } | null }> } }
      }).select('input_hash').order('last_used_at', { ascending: true }).limit(overflow)
      if (oldestRes.error || !oldestRes.data) {
        return NextResponse.json({
          ok:               true,
          expired_deleted:  expiredDeleted,
          lru_deleted:      0,
          total_rows_after: totalRows,
          error:            oldestRes.error?.message ?? 'lru_select_failed',
        })
      }
      const hashesToDelete = oldestRes.data.map(r => r.input_hash)
      if (hashesToDelete.length > 0) {
        const delRes = await (db.from('agent_response_cache' as never) as unknown as {
          delete: () => { in: (c: string, v: string[]) => Promise<{ error: { message: string } | null }> }
        }).delete().in('input_hash', hashesToDelete)
        if (!delRes.error) {
          lruDeleted     = hashesToDelete.length
          totalRowsAfter = totalRows - lruDeleted
        }
      }
    }
  } catch (err) {
    return NextResponse.json({
      ok:               true,
      expired_deleted:  expiredDeleted,
      lru_deleted:      lruDeleted,
      total_rows_after: totalRowsAfter,
      error:            err instanceof Error ? err.message : 'lru_pass_failed',
    })
  }

  return NextResponse.json({
    ok:               true,
    expired_deleted:  expiredDeleted,
    lru_deleted:      lruDeleted,
    total_rows_after: totalRowsAfter,
  })
}
