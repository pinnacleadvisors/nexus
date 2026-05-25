/**
 * POST /api/cron-health/jobs/:id/update — edit URL and/or schedule on cron-job.org.
 *
 * Body (both keys optional, at least one required):
 *   {
 *     url?:      string,                  // full URL incl. ?secret= when applicable
 *     schedule?: {                         // partial schedule patch (cron-job.org wants arrays per field)
 *       minutes?: number[],
 *       hours?:   number[],
 *       mdays?:   number[],
 *       months?:  number[],
 *       wdays?:   number[],
 *     }
 *   }
 *
 * Proxies a PATCH to cron-job.org. Owner-gated. Returns the upstream status.
 * Companion to /enable so the operator can fix URL/schedule drift from the
 * /cron-health dashboard without running the sync script.
 *
 * 200 + ok:false on transient upstream failure (retry-storm safe — though
 * cron-job.org doesn't call THIS route, the convention stays consistent).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'

export const runtime     = 'nodejs'
export const maxDuration = 15

interface SchedulePatch {
  minutes?: number[]
  hours?:   number[]
  mdays?:   number[]
  months?:  number[]
  wdays?:   number[]
}
interface UpdateBody {
  url?:      string
  schedule?: SchedulePatch
}

function isOwner(userId: string | null | undefined): boolean {
  if (!userId) return false
  const raw = process.env.ALLOWED_USER_IDS?.trim()
  if (!raw) return true
  return raw.split(',').map(s => s.trim()).filter(Boolean).includes(userId)
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(req, { limit: 10, window: '1 m', prefix: 'cron-health:update' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!isOwner(session.userId)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { id } = await context.params
  if (!/^\d+$/.test(id)) return NextResponse.json({ ok: false, error: 'invalid job id' }, { status: 400 })

  let body: UpdateBody = {}
  try { body = await req.json() } catch { /* validated below */ }

  const jobPatch: Record<string, unknown> = {}
  if (typeof body.url === 'string' && body.url.length > 0) {
    if (!/^https?:\/\//.test(body.url)) {
      return NextResponse.json({ ok: false, error: 'url must start with http(s)://' }, { status: 400 })
    }
    jobPatch.url = body.url
  }
  if (body.schedule && typeof body.schedule === 'object') {
    // cron-job.org wants array-per-field — keep our pass-through strict.
    const s: Record<string, number[]> = {}
    for (const k of ['minutes', 'hours', 'mdays', 'months', 'wdays'] as const) {
      const v = body.schedule[k]
      if (Array.isArray(v) && v.every(n => typeof n === 'number')) s[k] = v
    }
    if (Object.keys(s).length > 0) jobPatch.schedule = { timezone: 'UTC', ...s }
  }
  if (Object.keys(jobPatch).length === 0) {
    return NextResponse.json({ ok: false, error: 'nothing to update (provide url and/or schedule)' }, { status: 400 })
  }

  const apiKey = process.env.CRONJOB_ORG_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'CRONJOB_ORG_API_KEY not configured' }, { status: 200 })
  }

  try {
    const res = await fetch(`https://api.cron-job.org/jobs/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body:    JSON.stringify({ job: jobPatch }),
      signal:  AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json({
        ok:    false,
        error: `cron-job.org PATCH → ${res.status}`,
        detail: text.slice(0, 300),
      }, { status: 200 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({
      ok:    false,
      error: e instanceof Error ? e.message : 'cron-job.org PATCH failed',
    }, { status: 200 })
  }
}
