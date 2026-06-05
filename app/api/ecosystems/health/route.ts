/**
 * GET /api/ecosystems/health — owner-only ecosystem-adapter coverage probe.
 *
 * Operator/agent visibility surface for "which capabilities can the platform
 * route, and which are dark for lack of config". Built on the registry's own
 * countAvailableByKind() + listEcosystemsByKind(). Read-only, no upstream
 * network calls — just reflects each adapter's available() (env presence).
 *
 * Returns the per-kind wired/total counts plus, for each kind, the bound
 * adapters with their availability. Always 200 (degraded info, not an error)
 * so dashboards/agents can poll it safely.
 *
 * Auth: Clerk + ALLOWED_USER_IDS — mirrors /api/health/deep.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import {
  countAvailableByKind,
  listEcosystemsByKind,
} from '@/lib/ecosystems/registry'
import type { EcosystemKind } from '@/lib/ecosystems/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 10

const KINDS: readonly EcosystemKind[] = [
  'llm', 'code', 'design', 'video', 'image', 'voice', 'music', 'avatar',
  'speech', 'memory', 'search', 'browser', 'workflow', 'voice-agent', 'doc-parse',
]

function getAllowedUserIds(): Set<string> | null {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return null
  return new Set(raw.split(',').map(id => id.trim()).filter(Boolean))
}

function isOwner(userId: string): boolean {
  const allowed = getAllowedUserIds()
  if (!allowed) return true
  return allowed.has(userId)
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session.userId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (!isOwner(session.userId)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const rl = await rateLimit(req, { limit: 12, window: '1 m', prefix: 'ecosystems:health', identifier: session.userId })
  if (!rl.success) return rateLimitResponse(rl)

  try {
    const counts = countAvailableByKind()

    const kinds = KINDS.map(kind => {
      const adapters = listEcosystemsByKind(kind).map(a => ({
        name:      a.name,
        label:     a.label,
        available: a.available(),
        verbs:     a.capabilities,
      }))
      const c = counts[kind] ?? { wired: 0, total: 0 }
      return {
        kind,
        registered: c.total,        // adapters in the registry for this kind
        wired:      c.wired,         // adapters whose env is configured (available())
        dark:       c.total > 0 && c.wired === 0,  // registered but none callable
        uncovered:  c.total === 0,   // no adapter at all (should never happen — guarded by check:ecosystem-bindings)
        adapters,
      }
    })

    const totals = {
      kinds:               KINDS.length,
      kinds_uncovered:     kinds.filter(k => k.uncovered).length,
      kinds_dark:          kinds.filter(k => k.dark).length,
      adapters_registered: kinds.reduce((n, k) => n + k.registered, 0),
      adapters_wired:      kinds.reduce((n, k) => n + k.wired, 0),
    }

    return NextResponse.json({ ok: true, totals, kinds })
  } catch (err) {
    // Degraded info, not a failure — keep 200 so pollers don't trip alarms.
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'probe_failed' })
  }
}
