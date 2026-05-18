/**
 * /api/dashboard/fleet
 *
 * GET — per-business "CEO glance" aggregator. Returns each business the
 * caller owns enriched with:
 *   - metrics.spend24h         — sum of experiment_metrics.kind=cash_spend in last 24h
 *   - metrics.revenue24h       — sum of experiment_metrics.kind=revenue   in last 24h
 *   - metrics.netDelta24h      — revenue24h - spend24h
 *   - metrics.pendingApprovals — count of unresolved approval-request blocks
 *                                in chat_messages scoped to this business
 *   - metrics.lastActivityIso  — max(experiment_metrics.ts, chat_messages.created_at)
 *
 * V2 of the FleetOverview card per the 2026-05-16 audit (Section 8 #4).
 * V1 (PR #201) only had name + status + niche. V2 adds the steering signals.
 *
 * NOT in V2 (deferred):
 *   - "active runs count" — runs table has no business_slug column today;
 *     would need a separate migration. Tracked as V3.
 *   - "cycle status (green/yellow/red)" — same blocker.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createServerClient } from '@/lib/supabase'
import { listBusinessesForUser } from '@/lib/business/db'
import type { ApprovalRequest } from '@/lib/chat/approval'
import type { FleetBusiness, FleetBusinessMetrics } from '@/lib/dashboard/fleet-types'

// Re-export so existing references keep resolving. The canonical home of
// these types is lib/dashboard/fleet-types.ts (client-safe import).
export type { FleetBusiness, FleetBusinessMetrics }

export const runtime    = 'nodejs'
export const maxDuration = 10

/* ── Approval-resolution detection (mirrors /api/approvals/fleet) ──────── */

interface ChatMessageRow {
  id:         string
  session_id: string
  role:       'user' | 'assistant' | 'system'
  content:    string
  metadata:   { approval_requests?: ApprovalRequest[] } | null
  created_at: string
}

interface ChatSessionRow {
  id:    string
  scope: string
}

function isResolved(approval: ApprovalRequest, sessionMessages: ChatMessageRow[], thisMsgIdx: number): boolean {
  const re = new RegExp(
    `APPROVAL\\s*\\[${approval.approval_id.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\]\\s*:`,
    'i',
  )
  for (let i = thisMsgIdx + 1; i < sessionMessages.length; i++) {
    if (sessionMessages[i].role === 'user' && re.test(sessionMessages[i].content)) return true
  }
  return false
}

/* ── Query helpers ─────────────────────────────────────────────────────── */

interface ExperimentMetricRow {
  business_slug: string
  kind:          'cash_spend' | 'revenue' | string
  ts:            string
  payload:       Record<string, unknown>
}

/**
 * Extract the USD value from a metric payload. Different writers use slightly
 * different shapes (`payload.usd`, `payload.amount_usd`, `payload.amount`).
 * Coerce the first numeric one we find; default to 0.
 */
function payloadUsd(payload: Record<string, unknown>): number {
  const candidates = [payload.usd, payload.amount_usd, payload.amount]
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c
    if (typeof c === 'string') {
      const n = Number(c)
      if (Number.isFinite(n)) return n
    }
  }
  return 0
}

interface AggSet {
  spend24h:        number
  revenue24h:      number
  lastActivityTs:  number | null   // epoch ms
}

function emptyAgg(): AggSet {
  return { spend24h: 0, revenue24h: 0, lastActivityTs: null }
}

/* ── Response shape ────────────────────────────────────────────────────── */

interface OkResp  { ok: true;  businesses: FleetBusiness[] }
interface ErrResp { ok: false; error: string }

/* ── GET ───────────────────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'dashboard:fleet' })
  if (!rl.success) return rateLimitResponse(rl)

  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json<ErrResp>({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const businesses = await listBusinessesForUser(userId)
  if (businesses.length === 0) {
    return NextResponse.json<OkResp>({ ok: true, businesses: [] })
  }

  const db = createServerClient()
  if (!db) {
    // Degrade gracefully — return businesses without metrics so the V2 UI
    // still renders the V1 card layout when Supabase isn't configured.
    return NextResponse.json<OkResp>({
      ok: true,
      businesses: businesses.map(b => ({ ...b, metrics: zeroMetrics() })),
    })
  }

  const slugs       = businesses.map(b => b.slug)
  const sinceIso    = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const aggBySlug   = new Map<string, AggSet>(slugs.map(s => [s, emptyAgg()]))

  /* ── 24h experiment_metrics aggregate ─────────────────────────────── */
  try {
    const expRes = await (db.from('experiment_metrics' as never) as unknown as {
      select: (c: string) => {
        in: (c: string, v: string[]) => {
          gte: (c: string, v: string) => {
            order: (c: string, o: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: ExperimentMetricRow[] | null }>
            }
          }
        }
      }
    })
      .select('business_slug,kind,ts,payload')
      .in('business_slug', slugs)
      .gte('ts', sinceIso)
      .order('ts', { ascending: false })
      .limit(5000)

    for (const row of expRes.data ?? []) {
      const agg = aggBySlug.get(row.business_slug)
      if (!agg) continue
      if (row.kind === 'cash_spend') agg.spend24h   += payloadUsd(row.payload)
      if (row.kind === 'revenue')    agg.revenue24h += payloadUsd(row.payload)
      const t = new Date(row.ts).getTime()
      if (Number.isFinite(t)) {
        agg.lastActivityTs = agg.lastActivityTs === null ? t : Math.max(agg.lastActivityTs, t)
      }
    }
  } catch (err) {
    console.warn('[dashboard/fleet] experiment_metrics aggregate failed:', err)
    // Continue — return zero metrics rather than failing the whole response.
  }

  /* ── Pending approvals per business (chat_messages scan) ──────────── */
  const pendingBySlug = new Map<string, number>(slugs.map(s => [s, 0]))
  try {
    const sessionsRes = await (db.from('chat_sessions' as never) as unknown as {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          order: (c: string, o: { ascending: boolean }) => {
            limit: (n: number) => Promise<{ data: ChatSessionRow[] | null }>
          }
        }
      }
    })
      .select('id, scope')
      .eq('user_id', userId)
      .order('last_message_at', { ascending: false })
      .limit(100)
    const sessionRows = sessionsRes.data ?? []

    // Filter to business-scope sessions only — platform-scope approvals
    // aren't per-business and surface via the cross-business inbox, not here.
    const bizSessions = sessionRows.filter(s => s.scope.startsWith('business:'))
    if (bizSessions.length > 0) {
      const messagesRes = await (db.from('chat_messages' as never) as unknown as {
        select: (c: string) => {
          in: (c: string, v: string[]) => {
            order: (c: string, o: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: ChatMessageRow[] | null }>
            }
          }
        }
      })
        .select('id, session_id, role, content, metadata, created_at')
        .in('session_id', bizSessions.map(s => s.id))
        .order('created_at', { ascending: true })
        .limit(5000)
      const messageRows = messagesRes.data ?? []

      const bySession = new Map<string, ChatMessageRow[]>()
      for (const m of messageRows) {
        const arr = bySession.get(m.session_id) ?? []
        arr.push(m)
        bySession.set(m.session_id, arr)
      }

      const slugBySession = new Map(bizSessions.map(s => [s.id, s.scope.slice('business:'.length)]))

      for (const [sid, msgs] of bySession) {
        const slug = slugBySession.get(sid)
        if (!slug || !pendingBySlug.has(slug)) continue
        msgs.forEach((m, idx) => {
          const reqs = m.metadata?.approval_requests
          if (!Array.isArray(reqs)) return
          for (const ar of reqs) {
            if (!isResolved(ar, msgs, idx)) {
              pendingBySlug.set(slug, (pendingBySlug.get(slug) ?? 0) + 1)
              // Latest message activity also feeds the lastActivityTs for that biz.
              const t = new Date(m.created_at).getTime()
              const agg = aggBySlug.get(slug)
              if (agg && Number.isFinite(t)) {
                agg.lastActivityTs = agg.lastActivityTs === null ? t : Math.max(agg.lastActivityTs, t)
              }
            }
          }
        })
      }
    }
  } catch (err) {
    console.warn('[dashboard/fleet] chat-messages approval scan failed:', err)
  }

  /* ── Combine ──────────────────────────────────────────────────────── */
  const enriched: FleetBusiness[] = businesses.map(b => {
    const agg = aggBySlug.get(b.slug) ?? emptyAgg()
    return {
      ...b,
      metrics: {
        spend24h:         round2(agg.spend24h),
        revenue24h:       round2(agg.revenue24h),
        netDelta24h:      round2(agg.revenue24h - agg.spend24h),
        pendingApprovals: pendingBySlug.get(b.slug) ?? 0,
        lastActivityIso:  agg.lastActivityTs !== null
          ? new Date(agg.lastActivityTs).toISOString()
          : null,
      },
    }
  })

  return NextResponse.json<OkResp>({ ok: true, businesses: enriched })
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function zeroMetrics(): FleetBusinessMetrics {
  return { spend24h: 0, revenue24h: 0, netDelta24h: 0, pendingApprovals: 0, lastActivityIso: null }
}
