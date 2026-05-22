/**
 * Spec: /businesses/<slug>/chat round-trip.
 *
 * Picks the first business returned by GET /api/businesses, navigates to its
 * chat surface, sends a message, asserts the round-trip completes (same
 * Send → Working → Send pattern as platform-chat.spec.ts).
 *
 * Skipped when:
 *   - BOT_SESSION_TICKET_URL is not set (no auth)
 *   - The signed-in user owns zero businesses (nothing to test)
 */

import { test, expect } from '@playwright/test'
import { requireAuth, redeemTicket } from './_helpers'

interface Business {
  slug: string
  name: string
}

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  const auth = requireAuth()
  await redeemTicket(page, auth.ticketUrl)
})

test('business copilot accepts a message and processes it', async ({ page, request }) => {
  // The Playwright request fixture inherits the page's cookie jar after we
  // redeemed the ticket, so this API call is authenticated as the bot user.
  const listResp = await request.get('/api/businesses')
  expect(listResp.ok(), `GET /api/businesses returned HTTP ${listResp.status()}`).toBe(true)

  const body = await listResp.json() as { ok?: boolean; businesses?: Business[] }
  const businesses = body.businesses ?? []
  test.skip(businesses.length === 0, 'No businesses for this user — create one to enable business-chat smoke')

  const slug = businesses[0].slug
  const response = await page.goto(`/businesses/${slug}/chat`, { waitUntil: 'domcontentloaded' })
  expect(response, `no response for /businesses/${slug}/chat`).not.toBeNull()
  expect(response!.status(), `/businesses/${slug}/chat returned ${response!.status()}`).toBeLessThan(400)

  const composer = page.locator('textarea').first()
  await composer.waitFor({ state: 'visible', timeout: 15_000 })

  const sendButton = page.locator('button').filter({ hasText: /^Send$/ }).first()
  await sendButton.waitFor({ state: 'visible', timeout: 5_000 })

  await composer.fill('ping — Playwright smoke test, please respond briefly')
  await sendButton.click()

  // Mirror the platform-chat assertion: either Send returns (success) or an
  // explicit error renders. A perpetual Working… is the regression.
  const sendOrError = page.locator('button:has-text("Send"), [role="alert"], text=/error|failed|unauthor/i').first()
  await expect(sendOrError, `business-${slug} copilot did not return to Send state within 60s`).toBeVisible({ timeout: 60_000 })
})
