/**
 * Spec: Settings → Skills lists at least one skill.
 *
 * The Skills tab reads from .claude/skills/ via /api/skills. A regression
 * where the API returns an empty array (broken filesystem read, missing
 * permissions in a containerised dev env, parse error on a malformed
 * SKILL.md) surfaces here. The repo currently ships ≥3 skills, so the
 * threshold is liberal: as long as one renders, the read path is alive.
 *
 * Skipped without BOT_SESSION_TICKET_URL.
 */

import { test, expect } from '@playwright/test'
import { requireAuth, redeemTicket } from './_helpers'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  const auth = requireAuth()
  await redeemTicket(page, auth.ticketUrl)
})

test('Skills tab lists at least one skill', async ({ page }) => {
  await page.goto('/settings?tab=skills', { waitUntil: 'domcontentloaded' })

  // Wait for the loading state to clear. SkillsList renders a "Loading skills…"
  // pill while the fetch is in flight; once data lands the pill goes away and
  // either an empty-state message OR the cards grid appears.
  await expect(page.locator('text=Loading skills…')).toHaveCount(0, { timeout: 15_000 })

  // Each skill card has a <code>/{slug}</code> badge. Counting these is the
  // most stable selector — the surrounding card styling can change without
  // breaking the spec, and a card without a slug isn't a real skill.
  const slugBadges = page.locator('code').filter({ hasText: /^\// })
  const count      = await slugBadges.count()
  expect(count, 'Skills tab rendered zero skill rows — /api/skills returned empty or read path is broken').toBeGreaterThanOrEqual(1)
})
