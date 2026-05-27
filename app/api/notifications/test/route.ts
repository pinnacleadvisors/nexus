/**
 * POST /api/notifications/test — fire a test notification.
 *
 * Body: { category?: NotificationCategory, channel?: NotificationChannel }
 *
 * If `channel` is omitted, dispatches to all enabled channels for the
 * given category. If `category` is omitted, defaults to 'security-alert'
 * (the safest test category — almost always opted in).
 *
 * Returns the DispatchResult so the operator sees per-channel outcome.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import {
  notifyOperator,
  type NotificationCategory,
  type NotificationChannel,
} from '@/lib/notifications/dispatch'
import { sendSlackNotification } from '@/lib/notifications/slack'
import { sendWebPushNotification } from '@/lib/notifications/webpush'

export const runtime = 'nodejs'
export const maxDuration = 15

interface Body { category?: unknown; channel?: unknown }

const VALID_CATEGORIES: ReadonlySet<NotificationCategory> = new Set([
  'approval-pending', 'kill-switch', 'graduation', 'security-alert', 'weekly-digest',
])
const VALID_CHANNELS: ReadonlySet<NotificationChannel> = new Set(['slack', 'webpush'])

export async function POST(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 10, window: '1 m', prefix: 'notifications:test' },
  })
  if ('response' in g) return g.response

  const body     = await req.json().catch(() => ({})) as Body
  const category = (typeof body.category === 'string' && VALID_CATEGORIES.has(body.category as NotificationCategory))
                     ? body.category as NotificationCategory : 'security-alert'
  const channel  = (typeof body.channel === 'string' && VALID_CHANNELS.has(body.channel as NotificationChannel))
                     ? body.channel as NotificationChannel : null

  const payload = {
    title:     '🔔 Nexus test notification',
    body:      `If you're reading this${channel ? ` on ${channel}` : ''}, the channel works. Sent from /settings → Alerts.`,
    link_href: '/inbox',
    severity:  'info' as const,
  }

  // When a specific channel is requested, send only there. Otherwise
  // fan out to all enabled channels for the category.
  if (channel === 'slack') {
    const r = await sendSlackNotification(g.userId, payload)
    return NextResponse.json({ ok: r.ok, results: [r] })
  }
  if (channel === 'webpush') {
    const r = await sendWebPushNotification(g.userId, payload)
    return NextResponse.json({ ok: r.ok, results: [r] })
  }
  const result = await notifyOperator(g.userId, category, payload)
  return NextResponse.json({ ok: result.delivered, ...result })
}
