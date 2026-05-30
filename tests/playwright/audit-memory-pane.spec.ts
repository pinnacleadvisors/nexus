/**
 * Spec: /audit Memory pane (2026-05-30 brain-dump, Akashic Thread B).
 *
 * Verifies the operator-visible outcome of the memory-observability slice:
 * the "Memory calls" pane (mcp_server='memory-hq' lens on tool_call_audit) is
 * registered and selectable in the /audit terminal's add-pane picker — so the
 * operator can watch the memory flow the way they asked.
 *
 * Auth: redeems a Clerk sign-in ticket (BOT_SESSION_TICKET_URL). Skips
 * cleanly when unset.
 */

import { test, expect, type Page } from '@playwright/test'
import { requireAuth } from './_helpers'

// Robust redemption — avoids the shared helper's networkidle hang against the
// Clerk sign-in page (see settings-providers-expansion.spec.ts for context).
async function redeemTicketRobust(page: Page, ticketUrl: string): Promise<void> {
  await page.goto(ticketUrl, { waitUntil: 'domcontentloaded' })
  await page
    .waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 45_000 })
    .catch(() => {})
}

test('Memory calls pane is selectable on /audit', async ({ page }) => {
  test.setTimeout(180_000)
  const auth = requireAuth()
  await redeemTicketRobust(page, auth.ticketUrl)

  await page.goto('/audit', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  // The add-pane <select> lists every not-yet-open source by label. "Memory
  // calls" must be among them (it's not a default tab).
  await page.getByText('Add pane', { exact: false }).first().waitFor({ state: 'visible', timeout: 40_000 }).catch(() => {})
  const optionTexts = await page.locator('option').allTextContents()
  expect(optionTexts.some((t) => /memory calls/i.test(t))).toBe(true)
})
