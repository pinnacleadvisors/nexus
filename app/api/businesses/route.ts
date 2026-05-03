/**
 * /api/businesses
 *
 * GET  — list businesses owned by the current user
 * POST — upsert a business row (insert or full update by slug)
 *
 * Settings UI uses both. Seed inserts: Settings UI POSTs the seed JSON from
 * `lib/business/seeds.ts` with the current user_id stamped in.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { listBusinessesForUser, upsertBusiness, getBusinessBySlug, type BusinessUpsert } from '@/lib/business/db'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { postVerification } from '@/lib/slack/client'
import { createServerClient } from '@/lib/supabase'
import { insertTask } from '@/lib/board/insert-task'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'businesses-list' })
  if (!rl.success) return rateLimitResponse(rl)
  const rows = await listBusinessesForUser(userId)
  return NextResponse.json({ ok: true, businesses: rows })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const rl = await rateLimit(req, { limit: 20, window: '1 m', prefix: 'businesses-upsert' })
  if (!rl.success) return rateLimitResponse(rl)

  let body: Partial<BusinessUpsert>
  try {
    body = (await req.json()) as Partial<BusinessUpsert>
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  if (!body.slug || !body.name || !body.niche) {
    return NextResponse.json(
      { error: 'slug, name, and niche are required' },
      { status: 400 },
    )
  }
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(body.slug)) {
    return NextResponse.json(
      { error: 'slug must be lowercase, hyphenated, 2-40 chars' },
      { status: 400 },
    )
  }

  const row: BusinessUpsert = {
    slug:                  body.slug,
    name:                  body.name,
    status:                body.status ?? 'active',
    user_id:               userId,
    brand_voice:           body.brand_voice ?? null,
    timezone:              body.timezone ?? 'Asia/Bangkok',
    daily_cron_local_hour: body.daily_cron_local_hour ?? 11,
    niche:                 body.niche,
    money_model:           body.money_model ?? {},
    kpi_targets:           body.kpi_targets ?? {},
    approval_gates:        body.approval_gates ?? [],
    slack_channel:         body.slack_channel ?? null,
    slack_webhook_url:     body.slack_webhook_url ?? null,
  }

  // Compare against persisted state to detect a slack URL change.
  const previous = await getBusinessBySlug(row.slug)
  const slackChanged =
    !!row.slack_webhook_url &&
    row.slack_webhook_url !== previous?.slack_webhook_url

  const saved = await upsertBusiness(row)
  if (!saved) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  // Verify the freshly-pasted webhook by sending a one-shot Block Kit message.
  // Failures are returned as a warning so the UI can prompt the owner to retry.
  let slackWarning: string | undefined
  if (slackChanged && row.slack_webhook_url) {
    const result = await postVerification(row.slack_webhook_url, {
      businessName: row.name,
      channel:      row.slack_channel ?? undefined,
    })
    if (result.ok) {
      // Drop a "Slack connected" card on the board so the owner sees a visible
      // confirmation alongside the Slack message itself.
      const db = createServerClient()
      if (db) {
        await insertTask(db, {
          title:         `🔌 Slack connected: ${row.name}`,
          description:   `Verification message delivered to ${row.slack_channel ?? 'the pinned channel'}. Approvals and run summaries will land here.`,
          column_id:     'review',
          priority:      'low',
          business_slug: row.slug,
          position:      0,
        }).then(({ error }) => {
          if (error) console.error('[businesses] slack-connected card insert:', error.message)
        })
      }
    } else if (result.silent) {
      // 200 OK from Slack but the message never reached a channel
      // (channel_is_archived, no_service, etc.). Most dangerous case — looks
      // like a successful POST but no human will see the messages.
      slackWarning = `Slack accepted the request but the message did NOT reach a channel. ${result.reason}`
    } else {
      slackWarning = `Slack rejected the webhook (${result.status || 'network error'}): ${result.reason}`
    }
  }

  return NextResponse.json({
    ok:            true,
    business:      saved,
    slack_warning: slackWarning,
  })
}
