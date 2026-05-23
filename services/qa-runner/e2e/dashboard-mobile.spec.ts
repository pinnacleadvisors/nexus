/**
 * Spec: mobile dashboard renders cleanly on phone-class viewports (qa-runner).
 *
 * Phase 2 of task_plan-mobile-copilot.md. Mirror of
 * tests/playwright/dashboard-mobile.spec.ts adapted for the qa-runner's
 * post-deploy smoke flow:
 *   - Hard-fails (instead of test.skip) when BOT_SESSION_TICKET_URL is
 *     unset — the orchestrator is supposed to mint one before invoking us.
 *     A skip would mask a missing-ticket regression.
 *   - Only runs on the `iphone` + `android` projects (skipped on chromium).
 *
 * Same three assertions as the local spec: no horizontal scroll, sidebar
 * collapsed to icon-rail, KpiGrid renders as a single column.
 */

import { test, expect } from '@playwright/test'

test.describe('mobile dashboard', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // `test.skip(condition, reason)` accepts a runtime boolean — using it
    // inside beforeEach gives us access to testInfo.project.name.
    test.skip(testInfo.project.name === 'chromium', 'desktop project — mobile-specific assertions')
    const ticketUrl = process.env.BOT_SESSION_TICKET_URL
    if (!ticketUrl) {
      throw new Error('BOT_SESSION_TICKET_URL is not set — orchestrator must mint a Clerk sign-in ticket before running specs')
    }
    await page.goto(ticketUrl, { waitUntil: 'networkidle' })
    await page.waitForURL(/\/(dashboard|forge|board|manage-platform|settings|businesses)/, { timeout: 15_000 }).catch(() => {})
  })

  test('dashboard fits the viewport without horizontal scroll', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'networkidle' })
    const dims = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(
      dims.scrollWidth,
      `dashboard scrolls horizontally on mobile — scrollWidth=${dims.scrollWidth}px clientWidth=${dims.clientWidth}px`,
    ).toBeLessThanOrEqual(dims.clientWidth + 1)
  })

  test('sidebar is collapsed to icon-rail on narrow viewports', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'networkidle' })
    const aside = page.locator('aside').first()
    await expect(aside, 'sidebar <aside> did not render').toBeVisible({ timeout: 5_000 })
    const width = await aside.evaluate(el => (el as HTMLElement).getBoundingClientRect().width)
    expect(width, `sidebar width on mobile should be ≤80px (icon rail); got ${width}px`).toBeLessThanOrEqual(80)
  })

  test('KpiGrid renders as a single column on phone-class viewports', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'networkidle' })
    const cards = page.locator('[class*="rounded-xl"][class*="p-4"]').filter({ hasText: /vs last month|—|%/ })
    const count = await cards.count()
    test.skip(count < 2, 'fewer than 2 KPI cards rendered — likely a fresh-account dashboard')

    const rects = await Promise.all(
      Array.from({ length: Math.min(count, 6) }, (_, i) => cards.nth(i).evaluate(el => (el as HTMLElement).getBoundingClientRect().left)),
    )
    const distinctLeftEdges = new Set(rects.map(x => Math.round(x))).size
    expect(distinctLeftEdges, `KpiGrid still uses multi-column on mobile — saw ${distinctLeftEdges} distinct left edges across ${rects.length} cards`).toBe(1)
  })
})
