/**
 * Shared helpers for the root Playwright suite.
 *
 * Auth model: most specs need a signed-in session. The qa-runner mints a
 * Clerk sign-in ticket and exports it as BOT_SESSION_TICKET_URL; we honour
 * the same env var so a developer can re-use the qa-bot infra locally, and
 * Phase 2's loop agent gets it for free. When neither BOT_SESSION_TICKET_URL
 * nor a local-dev credential pair is set, specs that need auth call
 * `requireAuth` which gracefully `test.skip()`s with a clear message.
 *
 * Design notes:
 *   - Skip > throw. A missing env should never fail CI for the developer who
 *     just ran `npx playwright test` without setup. Throwing was the
 *     qa-runner's choice because it runs in a controlled container; this
 *     suite runs anywhere.
 *   - Returns a redemption URL (not a promise) so callers can await page.goto
 *     directly. Keeps each spec's beforeEach to two lines.
 */

import { test, type Page } from '@playwright/test'

export interface AuthCheck {
  reason:    string
  ticketUrl: string
}

/**
 * Returns the Clerk sign-in ticket URL if BOT_SESSION_TICKET_URL is set.
 * Otherwise calls `test.skip()` so the caller's test body never runs.
 *
 * Usage:
 *   test.beforeEach(async ({ page }) => {
 *     const auth = requireAuth()
 *     await page.goto(auth.ticketUrl, { waitUntil: 'networkidle' })
 *   })
 */
export function requireAuth(): AuthCheck {
  const ticketUrl = process.env.BOT_SESSION_TICKET_URL
  if (!ticketUrl) {
    test.skip(true, 'BOT_SESSION_TICKET_URL not set — set it to a fresh Clerk sign-in ticket URL to run this spec')
    // Unreachable — test.skip() throws. Keeps TS narrowing happy.
    return { reason: 'skipped', ticketUrl: '' }
  }
  return { reason: 'authenticated', ticketUrl }
}

/**
 * Redeem the Clerk ticket. Lands somewhere under the protected route group;
 * the exact landing page depends on Clerk config and may be /dashboard,
 * /forge, or /. Caller is responsible for navigating to the spec's target
 * route after redemption.
 */
export async function redeemTicket(page: Page, ticketUrl: string): Promise<void> {
  await page.goto(ticketUrl, { waitUntil: 'networkidle' })
  // Clerk typically redirects to /dashboard after redemption. Some configs
  // land on / which then server-redirects. Either way the session cookie is
  // set by the time networkidle resolves.
  await page.waitForURL(/\/(dashboard|forge|board|manage-platform|settings|businesses)/, { timeout: 15_000 }).catch(() => {
    // Fall through — some configurations land on / after redemption. The
    // session cookie is still set; the next page.goto will land authenticated.
  })
}
