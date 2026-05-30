/**
 * Spec: /api/cron/accomplishments-recompute (Gamify persistence, migration 100).
 *
 * Server-to-server cron (CRON_SECRET bearer) — no browser auth needed. Proves
 * the route is reachable, authed, and returns the retry-storm-safe contract
 * (200 + {ok:true, recomputed}). Pre-migration it fail-softs (notified:0 because
 * recordNewUnlocks returns [] when the table is absent); post-migration it
 * persists newly-crossed tiers + fires the `milestone` notification once each.
 *
 * Requirements (skips cleanly otherwise): CRON_SECRET.
 */

import { test, expect } from '@playwright/test'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'

test('accomplishments-recompute cron is reachable + returns the 200 contract', async () => {
  const cronSecret = process.env.CRON_SECRET
  test.skip(!cronSecret, 'CRON_SECRET not set — needed to call the cron')

  const res = await fetch(BASE + '/api/cron/accomplishments-recompute', {
    method:  'POST',
    headers: { Authorization: `Bearer ${cronSecret}` },
  })
  expect(res.status, 'never 5xx (cron-route rule)').toBe(200)
  const j = (await res.json().catch(() => null)) as { ok?: boolean; recomputed?: number; notified?: number } | null
  expect(j?.ok, 'cron ran ok').toBe(true)
  expect(typeof j?.recomputed, 'recomputed is numeric').toBe('number')
  expect(typeof j?.notified, 'notified is numeric').toBe('number')

  // Unauthorized must be rejected (not silently 200).
  const noauth = await fetch(BASE + '/api/cron/accomplishments-recompute', { method: 'POST' })
  expect(noauth.status, 'rejects missing auth').toBe(401)
})
