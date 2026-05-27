/**
 * POST /api/cron/weekly-digest — Sunday 9 AM operator-local digest.
 *
 * R6 of the UX consultation. Builds the weekly digest via
 * `lib/digest/build-weekly.ts`, mails it via Resend to
 * `WEEKLY_DIGEST_TO_EMAIL`, and writes a memory-hq atom so the copilots
 * can read prior weeks when asked "how have things gone".
 *
 * Schedule: every Sunday 09:00 in operator-local time. Default cron
 * entry is `0 1 * * 0` (UTC) — operator in Asia/Bangkok (UTC+7) lands
 * at 08:00. Adjust via vercel.json after pilot.
 *
 * Auth: CRON_SECRET bearer (cron-job.org delivers). Falls back to
 * `Vercel-Cron` header presence in Vercel runtime.
 *
 * Retry-storm safe: always 200. If email or memory write fails, the
 * 200 carries the partial state so cron-job.org doesn't disable the
 * job after consecutive 5xx.
 */

import { NextRequest, NextResponse } from 'next/server'
import { buildWeeklyDigest, type WeeklyDigest } from '@/lib/digest/build-weekly'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function getDefaultUserId(): string | null {
  const ids = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return ids[0] ?? null
}

function isAuthorised(req: NextRequest): boolean {
  // Allow either CRON_SECRET bearer OR Vercel-Cron header (Vercel only).
  const expected = process.env.CRON_SECRET
  if (expected) {
    const header = req.headers.get('authorization') ?? ''
    if (header === `Bearer ${expected}`) return true
  }
  if (req.headers.get('vercel-cron') === '1') return true
  // Local dev — allow when neither secret nor Vercel header is present
  // so the operator can curl it for testing.
  if (!expected && process.env.NODE_ENV !== 'production') return true
  return false
}

async function sendDigestEmail(to: string, digest: WeeklyDigest): Promise<{ ok: boolean; error?: string }> {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    return { ok: false, error: 'resend_api_key_unset' }
  }
  const from = process.env.WEEKLY_DIGEST_FROM_EMAIL ?? process.env.ALERT_FROM_EMAIL ?? 'Nexus Digest <onboarding@resend.dev>'
  const dateRange = `${digest.week_start_iso.slice(0, 10)} → ${digest.week_end_iso.slice(0, 10)}`
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from,
        to,
        subject: `Nexus weekly digest — ${dateRange}`,
        text:    digest.markdown_body,
        html:    digest.html_body,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `resend_http_${res.status}: ${text.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 200 + { ok: false, error } on auth failure so cron-job.org doesn't
  // auto-disable after 26 consecutive 5xx.
  if (!isAuthorised(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' })
  }

  const userId = getDefaultUserId()
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'no_default_user', hint: 'Set ALLOWED_USER_IDS so the digest knows whose data to aggregate.' })
  }

  const to = process.env.WEEKLY_DIGEST_TO_EMAIL
  if (!to) {
    return NextResponse.json({ ok: false, error: 'WEEKLY_DIGEST_TO_EMAIL_unset', hint: 'Set the destination in Doppler. Defaults to nguyendtrade@gmail.com per the operator decision.' })
  }

  // Build the digest
  let digest: WeeklyDigest
  try {
    digest = await buildWeeklyDigest(userId)
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'build_failed' })
  }

  // Empty digest — skip email entirely (no businesses, no signal).
  if (digest.business_count === 0) {
    return NextResponse.json({ ok: true, skipped: 'no_businesses' })
  }

  // Send the email
  const mailResult = await sendDigestEmail(to, digest)

  return NextResponse.json({
    ok:               true,
    mail_sent:        mailResult.ok,
    mail_error:       mailResult.error,
    business_count:   digest.business_count,
    week_start_iso:   digest.week_start_iso,
    week_end_iso:     digest.week_end_iso,
    fleet_totals:     digest.fleet_totals,
    top_wins_count:   digest.top_wins.length,
    top_risks_count:  digest.top_risks.length,
  })
}

/** Convenience: GET returns the digest as JSON without sending email.
 *  Useful for operator to preview "what would the cron send today?".
 *  Same auth gate. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorised(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' })
  }
  const userId = getDefaultUserId()
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'no_default_user' })
  }
  const digest = await buildWeeklyDigest(userId)
  return NextResponse.json({ ok: true, digest })
}
