/**
 * GET/POST /api/cron/review-nag
 *
 * Daily cron. Cards that have sat in the Review column for >48h get the
 * operator a Slack DM (via the per-business webhook when business_slug is
 * stamped, else default NEXUS_SLACK_WEBHOOK_URL).
 *
 * Self-improvement loop 7.3 in task_plan-ux-security-onboarding.md.
 *
 * Auth: bearer CRON_SECRET OR Clerk owner.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import { getBusinessBySlug } from '@/lib/business/db'
import { postSlackNotification } from '@/lib/slack/client'
import { recordCronRun } from '@/lib/cron/record'

export const runtime = 'nodejs'
export const maxDuration = 30

interface StuckCard {
  id:            string
  title:         string
  business_slug: string | null
  created_at:    string
  updated_at:    string
}

function isCronAuthed(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`
}

async function findStuckReviews(): Promise<StuckCard[]> {
  const sb = createServerClient()
  if (!sb) return []
  const cutoff = new Date(Date.now() - 48 * 3600_000).toISOString()
  const resp = await (sb as unknown as {
    from: (t: string) => {
      select: (s: string) => {
        eq: (c: string, v: string) => {
          is: (c: string, v: null) => {
            lt: (c: string, v: string) => Promise<{ data: StuckCard[] | null }>
          }
        }
      }
    }
  }).from('tasks')
    .select('id, title, business_slug, created_at, updated_at')
    .eq('column_id', 'review')
    .is('archived_at', null)
    .lt('updated_at', cutoff)
  return resp.data ?? []
}

async function nagForCards(cards: StuckCard[]): Promise<{ posted: number; skipped: number }> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const fallbackHook = process.env.NEXUS_SLACK_WEBHOOK_URL
  let posted = 0
  let skipped = 0

  // Group by business_slug so we can hit each Slack channel at most once.
  const byBiz = new Map<string | null, StuckCard[]>()
  for (const c of cards) {
    const k = c.business_slug ?? null
    const list = byBiz.get(k) ?? []
    list.push(c)
    byBiz.set(k, list)
  }

  for (const [slug, list] of byBiz) {
    let webhookUrl: string | undefined
    if (slug) {
      const biz = await getBusinessBySlug(slug)
      webhookUrl = biz?.slack_webhook_url ?? undefined
    }
    webhookUrl = webhookUrl ?? fallbackHook

    if (!webhookUrl) { skipped += list.length; continue }

    const blocks: Array<Record<string, unknown>> = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${list.length} card${list.length === 1 ? '' : 's'} stuck in Review > 48h` },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: list.slice(0, 8).map(c => `• *${c.title}* — since ${c.updated_at.slice(0, 10)}`).join('\n'),
        },
      },
      {
        type: 'actions',
        elements: [{
          type: 'button',
          text: { type: 'plain_text', text: 'Open Board' },
          url:  `${baseUrl}/board`,
        }],
      },
    ]
    const ok = await postSlackNotification(
      { webhookUrl },
      { text: `${list.length} cards need review`, blocks },
    )
    if (ok) posted += list.length; else skipped += list.length
  }
  return { posted, skipped }
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthed(req)) {
    const a = await auth()
    if (!a.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const allowed = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    if (allowed.length > 0 && !allowed.includes(a.userId)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }
  try {
    const result = await recordCronRun('review-nag', async () => {
      const stuck = await findStuckReviews()
      const r = await nagForCards(stuck)
      return { found: stuck.length, ...r }
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'unknown' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
