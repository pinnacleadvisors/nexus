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
import { getBusinessBySlug, listBusinessesForUser, recordWebhookVerify, upsertBusiness, type BusinessUpsert } from '@/lib/business/db'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { postVerification } from '@/lib/slack/client'

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

  // Detect webhook-URL change so we can auto-verify and stamp a Board card on
  // first verify. Comparing pre-save value ensures we don't re-fire a Slack
  // ping on every "save" round-trip when the URL didn't actually change.
  const previous     = await getBusinessBySlug(row.slug)
  const isOwner      = !previous || previous.user_id === userId
  const webhookChanged = isOwner && row.slack_webhook_url !== (previous?.slack_webhook_url ?? null)

  const saved = await upsertBusiness(row)
  if (!saved) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  // Auto-verify on save when the URL changed and is non-empty. Failure does
  // NOT roll back the save — the operator can fix the URL and re-trigger
  // via the standalone Verify button (PR 4).
  let slackWarning: string | null = null
  if (webhookChanged && saved.slack_webhook_url) {
    const result = await postVerification(saved.slack_webhook_url, saved.name)
    await recordWebhookVerify(saved.slug, result)
    if (!result.ok) slackWarning = result.error ?? 'verification_failed'
  }

  return NextResponse.json({
    ok:            true,
    business:      saved,
    slack_warning: slackWarning,
    webhook_verified: webhookChanged && !slackWarning,
  })
}
