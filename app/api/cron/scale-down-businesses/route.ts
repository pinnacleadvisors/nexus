/**
 * GET /api/cron/scale-down-businesses
 *
 * Pauses idle per-business gateway containers to keep the N-business cost
 * bounded. Reads `connected_accounts.last_used_at` (and other recent-activity
 * signals if available) to decide which containers can sleep.
 *
 * Default policy:
 *   - Container is "idle" if no dispatch has touched it in the last 1h.
 *   - Idle containers get stopped via Coolify (`stopApp`).
 *   - On the next dispatch, the dispatch route can `startApp` to wake.
 *     (Wake logic lives in lib/coolify/client.ts; the wake-on-demand wiring
 *      is a follow-up Phase 6 item if needed.)
 *
 * Cron config: vercel.json calls this every 30 minutes.
 *
 * Idempotent: safe to re-run; already-stopped apps return 4xx which we
 * swallow.
 */

import { NextRequest, NextResponse } from 'next/server'
import { audit } from '@/lib/audit'
import { createServerClient } from '@/lib/supabase'
import { isConfigured as isCoolifyConfigured, listApps, stopApp, CoolifyError } from '@/lib/coolify/client'

export const runtime    = 'nodejs'
export const maxDuration = 60

const IDLE_THRESHOLD_MS = Number(process.env.NEXUS_BUSINESS_IDLE_MS ?? 60 * 60 * 1000) // 1h default
const NEVER_USED_GRACE_MS = Number(process.env.NEXUS_BUSINESS_NEVER_USED_MS ?? 24 * 60 * 60 * 1000) // 24h after creation before idle-sweep

function authoriseCron(req: NextRequest): boolean {
  // Vercel cron sends `Authorization: Bearer <CRON_SECRET>` when configured.
  const expected = process.env.CRON_SECRET
  if (!expected) return true // dev / un-secured — allow
  const got = req.headers.get('authorization') ?? ''
  if (got === `Bearer ${expected}`) return true
  return false
}

interface BusinessLastUsed {
  business_slug: string
  last_used_at:  string | null
  earliest_created_at: string | null
}

async function getBusinessActivity(): Promise<Record<string, BusinessLastUsed>> {
  const db = createServerClient()
  if (!db) return {}

  // Aggregate: max(last_used_at), min(created_at) per business_slug from
  // connected_accounts. We don't have a runs table indexed by business, so
  // last_used_at on Composio actions is our cheapest signal.
  const { data, error } = await (db.from('connected_accounts' as never) as unknown as {
    select: (cols: string) => Promise<{ data: Array<{ business_slug: string | null; last_used_at: string | null; created_at: string }> | null; error: { message: string } | null }>
  }).select('business_slug,last_used_at,created_at')

  if (error || !data) return {}

  const out: Record<string, BusinessLastUsed> = {}
  for (const row of data) {
    if (!row.business_slug) continue
    const cur = out[row.business_slug] ?? {
      business_slug:        row.business_slug,
      last_used_at:         null,
      earliest_created_at:  null,
    }
    if (row.last_used_at && (!cur.last_used_at || row.last_used_at > cur.last_used_at)) {
      cur.last_used_at = row.last_used_at
    }
    if (!cur.earliest_created_at || row.created_at < cur.earliest_created_at) {
      cur.earliest_created_at = row.created_at
    }
    out[row.business_slug] = cur
  }
  return out
}

interface ScaleDownReport {
  ok:           boolean
  scanned:      number
  stopped:      string[]
  kept:         string[]
  skipped:      string[]
  errors:       Array<{ uuid: string; error: string }>
  reason:       string
}

export async function GET(req: NextRequest) {
  if (!authoriseCron(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const report: ScaleDownReport = {
    ok:      true,
    scanned: 0,
    stopped: [],
    kept:    [],
    skipped: [],
    errors:  [],
    reason:  '',
  }

  if (!isCoolifyConfigured()) {
    report.ok     = false
    report.reason = 'Coolify not configured'
    return NextResponse.json(report, { status: 200 })
  }

  let apps
  try {
    apps = await listApps()
  } catch (err) {
    report.ok     = false
    report.reason = err instanceof Error ? err.message : 'coolify list failed'
    return NextResponse.json(report, { status: 200 })
  }

  const activity = await getBusinessActivity()
  const now = Date.now()

  for (const app of apps) {
    // We only scale Nexus per-business apps; identify by name prefix.
    if (!app.name.startsWith('nexus-business-')) {
      report.skipped.push(app.uuid)
      continue
    }
    report.scanned++

    const slug   = app.name.slice('nexus-business-'.length)
    const status = (app.status ?? '').toLowerCase()

    if (status.includes('stopped') || status.includes('exited') || status.includes('paused')) {
      // Already at rest.
      report.kept.push(slug)
      continue
    }

    const act    = activity[slug]
    const lastTs = act?.last_used_at ? new Date(act.last_used_at).getTime() : 0
    const createdTs = act?.earliest_created_at ? new Date(act.earliest_created_at).getTime() : 0

    // Grace period for never-used containers — wait NEVER_USED_GRACE_MS after
    // the earliest connection or provisioning before yanking them, so the
    // owner has time to do the initial OAuth round-trips.
    if (!lastTs && createdTs && (now - createdTs) < NEVER_USED_GRACE_MS) {
      report.kept.push(slug)
      continue
    }
    // Never-used + past grace OR last-used > threshold ago.
    const idleMs = lastTs ? now - lastTs : NEVER_USED_GRACE_MS + 1
    if (idleMs < IDLE_THRESHOLD_MS) {
      report.kept.push(slug)
      continue
    }

    try {
      await stopApp(app.uuid)
      report.stopped.push(slug)
    } catch (err) {
      // 4xx on already-stopped is fine; capture other errors.
      if (err instanceof CoolifyError && err.status >= 400 && err.status < 500) {
        report.kept.push(slug)
      } else {
        report.errors.push({ uuid: app.uuid, error: err instanceof Error ? err.message : 'stop failed' })
      }
    }
  }

  audit(req, {
    action:   'cron.scale_down_businesses',
    resource: 'businesses',
    metadata: {
      scanned: report.scanned,
      stopped: report.stopped.length,
      kept:    report.kept.length,
      errors:  report.errors.length,
    },
  })

  return NextResponse.json(report)
}
