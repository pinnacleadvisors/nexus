/**
 * GET  /api/notifications/settings — operator notification settings.
 * PATCH /api/notifications/settings — toggle one (channel, category).
 *
 * Body for PATCH:
 *   { channel: 'slack' | 'webpush', category: '<cat>', enabled: boolean }
 *
 * Backs the NotificationsPanel in /settings → Alerts (R4).
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import {
  getOperatorSettings,
  setChannelEnabled,
  type NotificationChannel,
  type NotificationCategory,
} from '@/lib/notifications/dispatch'
import { vapidPublicKey } from '@/lib/notifications/webpush'

export const runtime = 'nodejs'
export const maxDuration = 10

const CATEGORIES: NotificationCategory[] = [
  'approval-pending', 'kill-switch', 'graduation', 'security-alert', 'weekly-digest', 'chat-turn',
]
const CHANNELS: NotificationChannel[] = ['slack', 'webpush']

interface PatchBody { channel?: unknown; category?: unknown; enabled?: unknown }

export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'notifications:settings:get' },
  })
  if ('response' in g) return g.response

  const rows = await getOperatorSettings(g.userId)

  return NextResponse.json({
    ok:        true,
    settings:  rows,
    categories: CATEGORIES,
    channels:   CHANNELS,
    // Surface so the UI can show "VAPID keys missing — set in Doppler"
    // when the operator tries to enable webpush.
    vapid_public_key: vapidPublicKey(),
    webpush_configured: !!vapidPublicKey(),
  })
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 30, window: '1 m', prefix: 'notifications:settings:set' },
  })
  if ('response' in g) return g.response

  const body = await req.json().catch(() => ({})) as PatchBody
  const channel  = body.channel
  const category = body.category
  const enabled  = body.enabled

  if (typeof channel !== 'string' || !CHANNELS.includes(channel as NotificationChannel)) {
    return NextResponse.json({ ok: false, error: 'invalid_channel' })
  }
  if (typeof category !== 'string' || !CATEGORIES.includes(category as NotificationCategory)) {
    return NextResponse.json({ ok: false, error: 'invalid_category' })
  }
  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'invalid_enabled' })
  }

  const out = await setChannelEnabled(
    g.userId,
    channel  as NotificationChannel,
    category as NotificationCategory,
    enabled,
  )
  if (!out.ok) {
    return NextResponse.json({
      ok:       false,
      error:    out.error,
      degraded: out.degraded,
      hint:     out.degraded
        ? 'Apply migration 091_notification_settings.sql via `doppler run -- npm run migrate`.'
        : undefined,
    })
  }
  return NextResponse.json({ ok: true })
}
