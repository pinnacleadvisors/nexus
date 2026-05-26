/**
 * Spec: hyperbolic-chamber A/B compare flow (v2-A, PR #365).
 *
 * Walks the operator path:
 *   1. Find a sim business (skip if none).
 *   2. Open /businesses/<slug>/simulate.
 *   3. Pick "A/B compare" mode, tick permissive + skeptical, set
 *      compress=2, budget=120s → Start A/B.
 *   4. Verify redirect to /simulate/compare/<gid>.
 *   5. Wait for both rows to reach status='done' in the comparison
 *      table.
 *   6. Assert the comparison-takeaways block appears once both runs
 *      finish.
 *
 * Skipped when:
 *   - BOT_SESSION_TICKET_URL unset (no auth)
 *   - User owns no simulation business
 */

import { test, expect } from '@playwright/test'
import { requireAuth, redeemTicket } from './_helpers'

interface Business {
  slug:        string
  name:        string
  simulation?: boolean
}

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  const auth = requireAuth()
  await redeemTicket(page, auth.ticketUrl)
})

test('operator can run a two-policy A/B comparison end-to-end', async ({ page, request }) => {
  const listRes = await request.get('/api/businesses')
  expect(listRes.ok()).toBeTruthy()
  const listBody = await listRes.json() as { businesses?: Business[] }
  const sim = (listBody.businesses ?? []).find(b => b.simulation === true)
  if (!sim) {
    test.skip(true, 'No simulation business found — run scripts/seed-simulation-business.mjs')
    return
  }

  await page.goto(`/businesses/${sim.slug}/simulate`)
  await expect(page.getByRole('heading', { name: /hyperbolic chamber/i })).toBeVisible({ timeout: 10_000 })

  // Switch to A/B mode
  await page.getByLabel(/^mode$/i).selectOption('ab-compare')

  // Pick permissive + skeptical. The component pre-selects both by default,
  // so we just confirm. Random should be unchecked.
  await expect(page.getByRole('checkbox', { name: /permissive/i })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: /skeptical/i })).toBeChecked()

  await page.getByLabel(/sim days/i).fill('2')
  await page.getByLabel(/wallclock budget/i).fill('120')

  // Click Start A/B (button text includes the count)
  await page.getByRole('button', { name: /start a\/b/i }).click()

  // Should redirect to the compare page
  await expect(page).toHaveURL(/\/simulate\/compare\/[0-9a-f-]{36}/, { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: /a\/b comparison/i })).toBeVisible()

  // Comparison table renders both rows
  await expect(page.getByRole('cell', { name: /permissive/i })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('cell', { name: /skeptical/i })).toBeVisible({ timeout: 10_000 })

  // Wait for both runs to finish — the takeaways block appears when allDone=true
  await expect(page.getByText(/comparison takeaways/i)).toBeVisible({ timeout: 120_000 })

  // Spot-check that at least one takeaway line is rendered (• prefix)
  await expect(page.getByText(/approval rate range:/i)).toBeVisible()
})
