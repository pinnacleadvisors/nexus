/**
 * Spec: Dev fixture harness — toggle + connected-accounts overlay.
 *
 * Exercises the end-to-end fixture flow without touching real Composio:
 *
 *   1. Visit /settings?tab=access — find the "Dev fixture harness" card
 *   2. Toggle it ON via the button → wait for the OFF→ON state change
 *   3. Hit GET /api/dev/fixtures/active → assert { ok:true, enabled:true }
 *   4. Hit GET /api/connected-accounts → assert at least 1 row carries
 *      `isFixture: true` (the overlay landed)
 *   5. Toggle it OFF (restore baseline) → assert overlay disappears from
 *      the GET /api/connected-accounts response
 *
 * Skipped without BOT_SESSION_TICKET_URL OR when migration 084 hasn't been
 * applied to the target DB (the toggle endpoint returns degraded:true in
 * that case and the spec exits cleanly).
 *
 * Why this spec matters for the dev loop:
 *   - Catches accidental removal of the fixture-mode toggle in /settings.
 *   - Catches drift in the connected-accounts overlay shape (e.g. someone
 *     removes `isFixture: true` from the response).
 *   - Smoke-checks that fixture-mode flips without breaking the page.
 *
 * Future expansion: drive the full create-business → graduate → chat
 * flow under fixture mode. K4 V2 — needs a fresh business slug per run
 * so it's idempotent, and a way to clean up after.
 */

import { test, expect } from '@playwright/test'
import { requireAuth, redeemTicket } from './_helpers'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  const auth = requireAuth()
  await redeemTicket(page, auth.ticketUrl)
})

interface ActiveBody {
  ok:       boolean
  enabled?: boolean
  degraded?: boolean
  error?:   string
}
interface AccountsBody {
  accounts: Array<{ id: string; platform: string; isFixture?: boolean }>
}

test('fixture mode toggle flips on/off + overlays connected-accounts', async ({ page, request }) => {
  // ── Pre-flight: migration 084 applied? ──────────────────────────────
  // If not, the toggle endpoint returns degraded:true. Skip cleanly so
  // the spec doesn't fail on fresh-install DBs.
  const probeRes  = await request.get('/api/dev/fixtures/active')
  const probeBody = await probeRes.json() as ActiveBody
  test.skip(probeBody.degraded === true,
    'Migration 084 not applied — run `doppler run -- npm run migrate` to enable fixture-mode spec.')

  const baselineEnabled = Boolean(probeBody.enabled)

  // Track for cleanup so the spec is idempotent.
  let weTurnedItOn = false

  try {
    // ── 1. Visit Access tab ──────────────────────────────────────────
    await page.goto('/settings?tab=access', { waitUntil: 'domcontentloaded' })

    // The card title "Dev fixture harness" is unique on the page.
    const cardHeading = page.getByRole('heading', { name: /Dev fixture harness/i })
    await cardHeading.waitFor({ state: 'visible', timeout: 15_000 })

    // ── 2. Flip it ON if currently OFF ───────────────────────────────
    if (!baselineEnabled) {
      const turnOn = page.getByRole('button', { name: /Turn fixture mode ON/i })
      await turnOn.click()
      weTurnedItOn = true
      // Wait for the OFF→ON transition. The button text flips to "Turn
      // fixture mode OFF" once the PATCH lands + state pulls fresh.
      await page.getByRole('button', { name: /Turn fixture mode OFF/i }).waitFor({ state: 'visible', timeout: 10_000 })
    }

    // ── 3. Assert API agrees ─────────────────────────────────────────
    const onRes  = await request.get('/api/dev/fixtures/active')
    const onBody = await onRes.json() as ActiveBody
    expect(onBody.ok).toBe(true)
    expect(onBody.enabled).toBe(true)

    // ── 4. Connected-accounts overlay landed ─────────────────────────
    const accountsRes  = await request.get('/api/connected-accounts')
    const accountsBody = await accountsRes.json() as AccountsBody
    const fixtureRows  = accountsBody.accounts.filter(a => a.isFixture === true)
    expect(fixtureRows.length, 'at least 1 fixture row should appear when fixture mode is on').toBeGreaterThan(0)

    // Sanity: rows are tagged + carry the right id prefix.
    for (const f of fixtureRows) {
      expect(f.id.startsWith('fixture:')).toBe(true)
      expect(typeof f.platform).toBe('string')
    }

  } finally {
    // ── 5. Restore baseline ──────────────────────────────────────────
    if (weTurnedItOn) {
      // Use API directly — UI may have navigated away in the failure branch.
      await request.patch('/api/dev/fixtures/active', {
        data: { enabled: false, reason: 'spec cleanup' },
      })
      const finalRes  = await request.get('/api/connected-accounts')
      const finalBody = await finalRes.json() as AccountsBody
      const fixtureRowsAfter = finalBody.accounts.filter(a => a.isFixture === true)
      expect(fixtureRowsAfter.length, 'fixture overlay should disappear after flipping off').toBe(0)
    }
  }
})
