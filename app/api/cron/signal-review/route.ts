/**
 * POST /api/cron/signal-review
 *
 * Drains the signals inbox: pulls up to MAX_PER_RUN rows in `status='new'`,
 * runs the LLM council on each, and persists evaluations + final verdicts.
 *
 *   POST /api/cron/signal-review            → drain up to MAX_PER_RUN signals
 *   POST /api/cron/signal-review?id=<uuid>  → process that signal only
 *
 * Two auth paths:
 *   1. Vercel Cron / external scheduler — `Authorization: Bearer $CRON_SECRET`
 *      is allowed without Clerk auth. The first user listed in
 *      ALLOWED_USER_IDS is treated as the row owner for the run.
 *   2. Owner manual trigger — falls back to guardRequest (Clerk session) +
 *      ALLOWED_USER_IDS check, matching `daily-extract` and `rebuild-graph`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { getSignal, listNewSignals } from '@/lib/signals/client'
import { processSignal, type ProcessSignalResult } from '@/lib/signals/council'

export const runtime = 'nodejs'
export const maxDuration = 300   // 5 min — covers ~2 council runs at gateway pace

const MAX_PER_RUN = 2

function getAllowedUserIds(): string[] {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return []
  return raw.split(',').map(id => id.trim()).filter(Boolean)
}

function isOwner(userId: string): boolean {
  const allowed = getAllowedUserIds()
  if (allowed.length === 0) return true
  return allowed.includes(userId)
}

/**
 * Cron-secret short circuit. Returns the Clerk user ID to act as, or null
 * when the request must use the regular Clerk path. The secret check is
 * timing-safe-ish (constant-length string compare) but Node's === is fine
 * for a non-online attacker model where the secret is in env, not user input.
 */
function cronSecretUserId(req: NextRequest): string | null {
  const secret = process.env.CRON_SECRET
  if (!secret) return null
  const header = req.headers.get('authorization') ?? ''
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (supplied !== secret) return null
  // Run as the first allowlisted user so signal_evaluations.user_id matches
  // the row's owner (RLS-friendly).
  const owner = getAllowedUserIds()[0]
  if (!owner) {
    return null
  }
  return owner
}

export async function POST(req: NextRequest) {
  // ── 1. Cron-secret path (Vercel cron, GitHub Actions, etc.) ─────────────
  const cronOwner = cronSecretUserId(req)
  let userId: string

  if (cronOwner) {
    userId = cronOwner
  } else {
    // ── 2. Clerk owner path (manual button, Inngest with bearer) ──────────
    const g = await guardRequest(req, {
      rateLimit: { limit: 12, window: '1 h', prefix: 'cron:signal-review' },
    })
    if ('response' in g) return g.response
    if (!isOwner(g.userId)) return NextResponse.json({ error: 'owner only' }, { status: 403 })
    userId = g.userId
  }

  const idParam = req.nextUrl.searchParams.get('id')
  const results: ProcessSignalResult[] = []

  if (idParam) {
    const signal = await getSignal(idParam)
    if (!signal || signal.userId !== userId) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    if (signal.status !== 'new' && signal.status !== 'triaging') {
      return NextResponse.json({ error: `signal already in terminal status: ${signal.status}` }, { status: 409 })
    }
    try {
      results.push(await processSignal(signal))
    } catch (err) {
      return NextResponse.json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        results,
      }, { status: 500 })
    }
    return NextResponse.json({ ok: true, processed: results.length, results })
  }

  const queue = await listNewSignals(MAX_PER_RUN)
  for (const signal of queue) {
    try {
      results.push(await processSignal(signal))
    } catch (err) {
      results.push({
        signalId:   signal.id,
        status:     'triaging',
        rolesRun:   [],
        scrapeUsed: false,
        error:      err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({
    ok:        true,
    processed: results.length,
    pending:   Math.max(0, queue.length - results.length),
    results,
  })
}
