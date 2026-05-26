/**
 * GET /api/approvals
 *
 * Compatibility alias for `/api/approvals/fleet` — preserves the URL
 * shape Mission Control's BentoMissionControl tile expects
 * (`/api/approvals?status=pending&limit=50`). The fleet route returns
 * `{ ok, pending: [...] }`; this route returns the same data as
 * `{ ok, rows: [...], count: N }` so the dashboard's countOf helper
 * finds the items where it expects them.
 *
 * Before this route existed the dashboard's `Pending approvals` tile
 * silently rendered 0 because the fetch was 404'ing.
 *
 * The first cut of this route proxied to /api/approvals/fleet over
 * HTTP, which CodeQL flagged as SSRF (the URL origin was derived from
 * req.url — safe behind Cloudflare Tunnel but technically user-influenced).
 * Now both routes call lib/approvals/fleet.ts directly — same code path,
 * zero HTTP roundtrip, ~50ms faster per dashboard load.
 *
 * Query params:
 *   status   (optional, default 'pending') — only 'pending' is supported today;
 *            other values return an empty list.
 *   limit    (optional, default 50, max 200) — cap on returned rows.
 *
 * Returns 200 always (retry-storm rule).
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { listFleetPending } from '@/lib/approvals/fleet'

export const runtime    = 'nodejs'
export const maxDuration = 10

export async function GET(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'approvals:list' },
  })
  if ('response' in g) return g.response

  const params = req.nextUrl.searchParams
  const status = (params.get('status') ?? 'pending').toLowerCase()
  const limitR = parseInt(params.get('limit') ?? '50', 10)
  const limit  = Number.isFinite(limitR) ? Math.max(1, Math.min(200, limitR)) : 50

  if (status !== 'pending') {
    // We don't persist resolved approvals separately yet — return empty
    // rather than 400 so the dashboard's polling never errors.
    return NextResponse.json({ ok: true, rows: [], count: 0 })
  }

  const db = createServerClient()
  if (!db) {
    return NextResponse.json({ ok: true, rows: [], count: 0 })
  }

  let pending: unknown[] = []
  try {
    pending = await listFleetPending(db, g.userId)
  } catch (err) {
    console.warn('[/api/approvals] listFleetPending failed:', err instanceof Error ? err.message : err)
  }

  const rows = pending.slice(0, limit)
  return NextResponse.json({ ok: true, rows, count: rows.length })
}
