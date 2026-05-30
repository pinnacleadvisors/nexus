/**
 * POST/GET /api/cron/accomplishments-recompute
 *
 * Recomputes each owner's achievement board from real revenue and fires the
 * `milestone` notification EXACTLY ONCE per newly-crossed tier. The
 * accomplishments_unlocked ledger (migration 100) is the transition guard:
 * recordNewUnlocks upserts-ignore-conflicts and returns only rows that were
 * actually inserted, so a re-run with no new revenue notifies zero times.
 *
 * Owners come from ALLOWED_USER_IDS (single-operator platform; comma-separated
 * for future team members). The cron has no per-user request context, so this
 * is the canonical owner roster.
 *
 * Auth: CRON_SECRET bearer OR bot bearer token (mirrors other crons).
 * Retry-storm safe: always 200 + {ok:false} on transient failure so
 * cron-job.org's retry policy never auto-disables the job on a Supabase blip.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { authBotToken } from '@/lib/auth/bot'
import { evaluate } from '@/lib/accomplishments/evaluate'
import { recordNewUnlocks } from '@/lib/accomplishments/unlocks'
import { notifyOperator } from '@/lib/notifications/dispatch'

export const runtime     = 'nodejs'
export const maxDuration = 60

function authed(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  const header     = req.headers.get('authorization') ?? ''
  if (cronSecret && header === `Bearer ${cronSecret}`) return true
  return Boolean(authBotToken(req))
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authed(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const owners = (process.env.ALLOWED_USER_IDS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
  if (owners.length === 0) {
    return NextResponse.json({ ok: true, recomputed: 0, notified: 0, reason: 'no ALLOWED_USER_IDS' })
  }

  let notified = 0
  for (const userId of owners) {
    try {
      const state  = await evaluate(userId)
      const newIds = await recordNewUnlocks(userId, state.unlocked.map(a => ({ id: a.id, level: a.level })))
      for (const id of newIds) {
        const a = state.unlocked.find(x => x.id === id)
        if (!a) continue
        await notifyOperator(userId, 'milestone', {
          title:     'Achievement unlocked 🏆',
          body:      `${a.label} — ${a.description}`,
          link_href: '/accomplishments',
          severity:  'info',
        }).catch(() => { /* notify is best-effort */ })
        notified++
      }
    } catch (e) {
      // Per-user fail-soft — one bad owner never stalls the sweep or 5xxes.
      console.warn('[accomplishments-recompute] user', userId, 'failed:', e instanceof Error ? e.message : e)
    }
  }

  return NextResponse.json({ ok: true, recomputed: owners.length, notified })
}

// cron-job.org / Vercel cron send GET by default. Mirror to POST.
export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req)
}
