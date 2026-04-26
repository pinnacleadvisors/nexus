/**
 * POST /api/slack/notify — E7 outbound notify endpoint.
 *
 * Body:
 *   {
 *     runId?:        string
 *     title:         string
 *     description?:  string
 *     dashboardPath?: string  // default `/board?runId=<runId>`
 *   }
 *
 * Auth-gated. Reads slack config for the caller, posts a Block Kit card to the
 * configured incoming webhook. Returns { ok, posted } so callers (Board UI,
 * cron jobs, wake hooks) can surface delivery status.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { approvalBlocks, getSlackConfig, postSlackNotification } from '@/lib/slack/client'

export const runtime = 'nodejs'

interface NotifyBody {
  runId?:         string
  title?:         string
  description?:   string
  dashboardPath?: string
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'slack-notify' })
  if (!rl.success) return rateLimitResponse(rl)

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: NotifyBody
  try { body = (await req.json()) as NotifyBody }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  if (!body.title) return NextResponse.json({ error: 'title required' }, { status: 400 })

  const cfg = await getSlackConfig(userId)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const path = body.dashboardPath ?? (body.runId ? `/board?runId=${encodeURIComponent(body.runId)}` : '/board')
  const dashboardUrl = `${baseUrl}${path}`

  const blocks = body.runId
    ? approvalBlocks({
        runId:       body.runId,
        title:       body.title,
        description: body.description ?? '',
        dashboardUrl,
      })
    : [
        { type: 'section', text: { type: 'mrkdwn', text: `*${body.title}*\n${body.description ?? ''}` } },
        { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in Nexus' }, url: dashboardUrl }] },
      ]

  const posted = await postSlackNotification(cfg, { text: body.title, blocks })

  audit(req, {
    action:     'slack.notify',
    resource:   body.runId ? 'run' : 'general',
    resourceId: body.runId,
    metadata:   { posted, hasWebhook: Boolean(cfg.webhookUrl) },
  })

  return NextResponse.json({ ok: true, posted, dashboardUrl })
}
