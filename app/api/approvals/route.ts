/**
 * GET /api/approvals
 *
 * Compatibility alias for `/api/approvals/fleet` — preserves the older
 * URL shape Mission Control's BentoMissionControl tile expects
 * (`/api/approvals?status=pending&limit=50`). The fleet route returns
 * `{ ok, pending: [...] }`; this route returns the same data as
 * `{ ok, rows: [...], count: N }` so the dashboard's countOf helper finds
 * the items where it expects them.
 *
 * Before this route existed the dashboard's `Pending approvals` tile
 * silently rendered 0 because the fetch was 404'ing. The fix here is
 * cheap — proxy through the existing fleet route with the operator's
 * cookies forwarded — and avoids duplicating the fleet's chat-message
 * walk logic.
 *
 * Query params:
 *   status   (optional, default 'pending') — only 'pending' is supported today;
 *            other values return an empty list (we don't yet store resolved
 *            approvals separately).
 *   limit    (optional, default 50, max 200) — cap on returned rows.
 *
 * Returns 200 always (retry-storm rule).
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'

export const runtime    = 'nodejs'
export const maxDuration = 10

export async function GET(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'approvals:list' },
  })
  if ('response' in g) return g.response

  const params  = req.nextUrl.searchParams
  const status  = (params.get('status') ?? 'pending').toLowerCase()
  const limitR  = parseInt(params.get('limit') ?? '50', 10)
  const limit   = Number.isFinite(limitR) ? Math.max(1, Math.min(200, limitR)) : 50

  if (status !== 'pending') {
    // We don't persist resolved approvals separately yet — return empty
    // rather than 400 so the dashboard's polling never errors.
    return NextResponse.json({ ok: true, rows: [], count: 0 })
  }

  // Same-origin proxy to the fleet route. Forward the operator's cookies
  // so the fleet route's auth + rate-limit see the same session. Use the
  // request's own origin so this works in every environment without a
  // hard-coded base URL.
  const origin = new URL(req.url).origin
  let pending: unknown[] = []
  try {
    const res = await fetch(`${origin}/api/approvals/fleet`, {
      method:  'GET',
      headers: {
        // Forward cookies for Clerk session
        cookie: req.headers.get('cookie') ?? '',
      },
      // Short timeout — the dashboard tile is already showing stale state.
      signal: AbortSignal.timeout(8_000),
      // Don't cache — the dashboard reads this on every page load.
      cache:  'no-store',
    })
    if (res.ok) {
      const body = await res.json() as { ok?: boolean; pending?: unknown[] }
      pending = Array.isArray(body.pending) ? body.pending : []
    }
  } catch (err) {
    console.warn('[/api/approvals] proxy to /fleet failed:', err instanceof Error ? err.message : err)
  }

  const rows = pending.slice(0, limit)
  return NextResponse.json({ ok: true, rows, count: rows.length })
}
