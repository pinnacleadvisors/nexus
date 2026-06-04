/**
 * lib/notifications/discord.ts — Discord channel for operator notifications.
 *
 * Part of the lean-Nexus pivot (ADR 012): Discord is the operator's alert
 * channel for the OSS workforce (Hermes/Paperclip are Discord-native too).
 * Posts to a Discord webhook (`NEXUS_DISCORD_WEBHOOK_URL`) — no OAuth needed.
 * Fail-soft: returns ok:false with a reason, never throws.
 */

import type { ChannelResult, NotificationPayload } from './dispatch'

function colorFor(sev?: string): number {
  if (sev === 'critical') return 0xef4444
  if (sev === 'warning') return 0xf59e0b
  return 0x4f46e5
}

export async function sendDiscordNotification(
  userId: string,
  payload: NotificationPayload,
): Promise<ChannelResult> {
  void userId // operator-scope; per-user webhooks could key off this later
  const url = process.env.NEXUS_DISCORD_WEBHOOK_URL?.trim()
  if (!url) return { channel: 'discord', ok: false, skipped: 'unconfigured', error: 'no_discord_webhook' }

  const prefix = payload.business_slug ? `[${payload.business_slug}] ` : ''
  const link = payload.link_href
    ? (payload.link_href.startsWith('http') ? payload.link_href : `${process.env.NEXUS_BASE_URL ?? ''}${payload.link_href}`)
    : undefined

  const embed: Record<string, unknown> = {
    title: `${prefix}${payload.title}`.slice(0, 256),
    description: payload.body.slice(0, 4000),
    color: colorFor(payload.severity),
  }
  if (link) embed.url = link

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ embeds: [embed], ...(link ? { content: link } : {}) }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { channel: 'discord', ok: false, error: `discord_http_${res.status}` }
    return { channel: 'discord', ok: true }
  } catch (err) {
    return { channel: 'discord', ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}
