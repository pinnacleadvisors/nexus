/**
 * POST /api/cron-health/jobs/:id/enable — re-enable a disabled cron-job.org job.
 *
 * Proxies a PATCH to cron-job.org's REST API with { enabled: true }. The
 * /cron-health page surfaces this on every disabled row (typically a job
 * that was auto-disabled after ~26 consecutive 5xx — see AGENTS.md retry-storm).
 *
 * Owner-gated. Returns the upstream's response status verbatim so the UI
 * can show a meaningful error.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'

export const runtime     = 'nodejs'
export const maxDuration = 15

function isOwner(userId: string | null | undefined): boolean {
  if (!userId) return false
  const raw = process.env.ALLOWED_USER_IDS?.trim()
  if (!raw) return true
  return raw.split(',').map(s => s.trim()).filter(Boolean).includes(userId)
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(req, { limit: 10, window: '1 m', prefix: 'cron-health:enable' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!isOwner(session.userId)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { id } = await context.params
  if (!/^\d+$/.test(id)) return NextResponse.json({ ok: false, error: 'invalid job id' }, { status: 400 })

  const apiKey = process.env.CRONJOB_ORG_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'CRONJOB_ORG_API_KEY not configured' }, { status: 200 })
  }

  try {
    const res = await fetch(`https://api.cron-job.org/jobs/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body:    JSON.stringify({ job: { enabled: true } }),
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
