/**
 * POST /api/businesses/verify-webhook
 *
 * Body: { slug: string }
 *
 * Posts a verification message to the business's Slack incoming webhook,
 * updates `webhook_last_verified_at` / `webhook_last_error`, and on the
 * first successful verify, inserts an idempotent Board card so the operator
 * has a visible confirmation that the wiring works.
 *
 * Auth: Clerk session, owner-only via ALLOWED_USER_IDS check on the row's
 * user_id. Defence-in-depth + per-business scoping.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { getBusinessBySlug, recordWebhookVerify } from '@/lib/business/db'
import { postVerification } from '@/lib/slack/client'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

interface VerifyBody { slug?: string }

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 10, window: '1 m', prefix: 'biz-webhook-verify' })
  if (!rl.success) return rateLimitResponse(rl)

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: VerifyBody
  try { body = await req.json() as VerifyBody }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  if (!body.slug) return NextResponse.json({ error: 'slug_required' }, { status: 400 })

  const biz = await getBusinessBySlug(body.slug)
  if (!biz) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (biz.user_id !== userId) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!biz.slack_webhook_url) {
    return NextResponse.json({ ok: false, error: 'no_webhook_configured' }, { status: 400 })
  }

  const wasVerifiedBefore = Boolean(biz.webhook_last_verified_at)
  const result = await postVerification(biz.slack_webhook_url, biz.name)
  await recordWebhookVerify(biz.slug, result)

  audit(req, {
    action:     'businesses.verify-webhook',
    resource:   'business',
    resourceId: biz.slug,
    metadata:   { ok: result.ok, error: result.error ?? null },
  })

  // First-time successful verify → idempotent Board card. Subsequent verifies
  // (re-clicking the button) skip card creation to avoid spam.
  let cardCreated = false
  if (result.ok && !wasVerifiedBefore) {
    cardCreated = await ensureSlackConnectedCard(biz.slug, biz.name)
  }

  return NextResponse.json({
    ok:           result.ok,
    error:        result.error ?? null,
    cardCreated,
    verifiedAt:   new Date().toISOString(),
  })
}

/**
 * Idempotent Board-card insert. Looks for an existing card scoped to the
 * business with the canonical "Slack connected" title; only inserts when
 * none is found.
 */
async function ensureSlackConnectedCard(slug: string, name: string): Promise<boolean> {
  const db = createServerClient()
  if (!db) return false

  const title = `🔌 ${name} — Slack connected`

  const exResp = await (db as unknown as {
    from: (t: string) => {
      select: (s: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => Promise<{ data: { id: string }[] | null }>
        }
      }
    }
  }).from('tasks').select('id').eq('business_slug', slug).eq('title', title)

  const existing = (exResp.data ?? [])
  if (existing.length > 0) return false

  await (db as unknown as {
    from: (t: string) => {
      insert: (row: object) => Promise<{ error: { message: string } | null }>
    }
  }).from('tasks').insert({
    title,
    description:   `Daily operator can now post to your Slack channel for *${name}*. Approve this card to acknowledge.`,
    column_id:     'review',
    priority:      'low',
    assignee:      'Nexus Platform',
    business_slug: slug,
    task_type:     'automated',
    position:      0,
  })

  return true
}
