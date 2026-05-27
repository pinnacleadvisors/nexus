/**
 * lib/notifications/webpush.ts — Web Push channel for notifications.
 *
 * R4 of the UX consultation. Sends a VAPID-signed push to every active
 * `push_subscriptions` row for the operator. Browsers display the push
 * via the service worker registered in `public/sw.js`.
 *
 * Activation:
 *   1. Operator generates a VAPID key pair: `npx web-push generate-vapid-keys`
 *   2. Put public + private keys in Doppler:
 *      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CONTACT_EMAIL
 *   3. Visit /settings → Alerts, click "Enable browser push" — the
 *      NotificationsPanel calls the browser's Notification API +
 *      PushManager.subscribe(...) and posts the result to
 *      POST /api/notifications/push-subscribe.
 *
 * Until VAPID keys are in Doppler, this module returns skipped:
 * 'unconfigured' for every dispatch. The settings UI surfaces a hint
 * + a "missing VAPID key" banner.
 *
 * No web-push npm dependency added in this PR — the actual signed
 * HTTP POST to the push endpoint is staged but disabled. The
 * subscription persistence + UI scaffolding ship now; the signed
 * delivery activates the moment the npm package + VAPID keys are
 * in place.
 *
 * Fail-soft: every path returns a ChannelResult; never throws.
 */

import { createServerClient } from '@/lib/supabase'
import type { ChannelResult, NotificationPayload } from './dispatch'

export interface PushSubscriptionRow {
  endpoint:    string
  p256dh:      string
  auth:        string
}

function vapidConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

async function loadSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
  const db = createServerClient()
  if (!db) return []
  try {
    const res = await (db.from('push_subscriptions' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => Promise<{ data: PushSubscriptionRow[] | null }> }
    }).select('endpoint, p256dh, auth').eq('user_id', userId)
    return res.data ?? []
  } catch {
    return []
  }
}

/**
 * Send a push notification to every active subscription for `userId`.
 *
 * V1 behaviour (no web-push npm dependency installed yet):
 *   - VAPID unconfigured → skipped:'unconfigured'
 *   - No subscriptions → skipped:'no-subscription'
 *   - Otherwise → returns ok:true with `delivered_count` for now (the
 *     signed POST to each endpoint is a one-line addition once the
 *     `web-push` package lands)
 *
 * The dispatcher contract treats `skipped` as non-failure — operator
 * sees the per-channel state in the settings UI; they fix Doppler
 * + the channel starts working on next dispatch.
 */
export async function sendWebPushNotification(
  userId:  string,
  payload: NotificationPayload,
): Promise<ChannelResult> {
  if (!vapidConfigured()) {
    return {
      channel:  'webpush',
      ok:      false,
      skipped: 'unconfigured',
      error:   'vapid_keys_missing',
    }
  }
  const subs = await loadSubscriptions(userId)
  if (subs.length === 0) {
    return {
      channel:  'webpush',
      ok:      false,
      skipped: 'no-subscription',
      error:   'no_active_subscription',
    }
  }

  // V1 stage: VAPID keys + subscriptions are present but the actual
  // signed POST is staged. The package install + sign-and-POST loop
  // is a follow-up. We DO write last_used_at so the operator sees
  // "would have delivered" in the UI when they fire a test.
  try {
    const db = createServerClient()
    if (db) {
      const nowIso = new Date().toISOString()
      const endpoints = subs.map(s => s.endpoint)
      await (db.from('push_subscriptions' as never) as unknown as {
        update: (row: Record<string, unknown>) => { in: (c: string, v: string[]) => Promise<unknown> }
      }).update({ last_used_at: nowIso }).in('endpoint', endpoints)
    }

    // Suppress unused-payload lint until the real delivery lands.
    void payload

    return {
      channel: 'webpush',
      ok:     false,
      skipped: 'unconfigured',
      error:  'webpush_stage_pending_install',
    }
  } catch (err) {
    return {
      channel: 'webpush',
      ok:     false,
      error:  err instanceof Error ? err.message : 'unknown',
    }
  }
}

/** Persist a fresh PushSubscription. Called by /api/notifications/
 *  push-subscribe after the browser's PushManager.subscribe() resolves. */
export async function savePushSubscription(
  userId:    string,
  endpoint:  string,
  p256dh:    string,
  auth:      string,
  userAgent: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const db = createServerClient()
  if (!db) return { ok: false, error: 'supabase_unconfigured' }
  try {
    await (db.from('push_subscriptions' as never) as unknown as {
      upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => Promise<{ error: { message: string } | null }>
    }).upsert({
      user_id:    userId,
      endpoint,
      p256dh,
      auth,
      user_agent: userAgent,
    }, { onConflict: 'user_id,endpoint' })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

/** Public VAPID key for the browser to subscribe. Returns null when
 *  unconfigured so the UI can show the "set VAPID_PUBLIC_KEY" hint. */
export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null
}
