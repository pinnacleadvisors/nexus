/**
 * /api/approvals/fleet
 *
 * GET — cross-scope pending-approvals inbox. Unlike /api/views/approvals
 * (per-scope, mounted in each chat surface's Views drawer), this endpoint
 * walks EVERY chat_session the operator owns — platform + every business —
 * and returns the union of unresolved approval-requests, tagged with their
 * originating scope so the UI can route the click back to the right chat
 * surface.
 *
 * Addresses 2026-05-16 audit Section 7 #2 + Section 8 #11 — the unified
 * "where do I need to steer right now?" view at /dashboard.
 *
 * Implementation moved to lib/approvals/fleet.ts so /api/approvals
 * (the compat alias) can call the same code without an HTTP roundtrip.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createServerClient } from '@/lib/supabase'
import { listFleetPending, type FleetPendingItem } from '@/lib/approvals/fleet'

export const runtime    = 'nodejs'
export const maxDuration = 10

interface OkResp  { ok: true;  pending: FleetPendingItem[] }
interface ErrResp { ok: false; error: string }

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'approvals:fleet' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) {
    return NextResponse.json<ErrResp>({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json<OkResp>({ ok: true, pending: [] })

  const pending = await listFleetPending(db, session.userId)
  return NextResponse.json<OkResp>({ ok: true, pending })
}
