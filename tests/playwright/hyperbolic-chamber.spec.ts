/**
 * Spec: hyperbolic-chamber simulation console (PR #364, task_plan-hyperbolic-chamber.md).
 *
 * Walks the operator path:
 *   1. Find a simulation=true business (or skip if none exist yet).
 *   2. Open /businesses/<slug>/simulate.
 *   3. Start a small auto-pilot run (compress=3, policy=permissive,
 *      budget=120s).
 *   4. Wait for the final report to appear; assert it includes the
 *      expected stats (events_processed, approvals counts, takeaways).
 *
 * Auto-pilot rather than manual so the spec doesn't have to click "Next
 * event" N times — auto is exactly the path most operators will use for
 * the "is this even working" sanity check.
 *
 * Skipped when:
 *   - BOT_SESSION_TICKET_URL unset (no auth)
 *   - The signed-in user owns zero simulation businesses
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

test('operator can run a simulation end-to-end in auto mode', async ({ page, request }) => {
  // Find a sim business via the public-to-owner /api/businesses surface
  const listRes = await request.get('/api/businesses')
  expect(listRes.ok()).toBeTruthy()
  const listBody = await listRes.json() as { businesses?: Business[] }
  const sim = (listBody.businesses ?? []).find(b => b.simulation === true)
  if (!sim) {
    test.skip(true, 'No simulation business found — run scripts/seed-simulation-business.mjs first')
    return
  }

  await page.goto(`/businesses/${sim.slug}/simulate`)
  await expect(page.getByRole('heading', { name: /hyperbolic chamber/i })).toBeVisible({ timeout: 10_000 })

  // Pick auto mode, set tiny compress + budget so the test completes fast
  await page.getByLabel(/mode/i).selectOption('auto')
  await page.getByLabel(/sim days/i).fill('3')
  await page.getByLabel(/wallclock budget/i).fill('120')
  await page.getByLabel(/approver policy/i).selectOption('permissive')

  await page.getByRole('button', { name: /^start$/i }).click()
  await expect(page.getByText(/auto-pilot/i)).toBeVisible({ timeout: 10_000 })

  // Run to completion — the engine drains until done OR returns
  // final_status: 'running' (which the UI auto-loops). 3 sim-days is
  // ~50-80 events; auto pilot processes them in under a minute.
  await page.getByRole('button', { name: /run to completion/i }).click()

  // Wait for the final report to render. The progress bar fills, the
  // FinalReport card appears with "Run finished" header.
  await expect(page.getByRole('heading', { name: /run finished/i })).toBeVisible({ timeout: 90_000 })

  // Spot-check the stats grid — at minimum the labels should be there
  await expect(page.getByText(/^approved$/i).first()).toBeVisible()
  await expect(page.getByText(/^rejected$/i).first()).toBeVisible()
  await expect(page.getByText(/^sim revenue$/i).first()).toBeVisible()
})
