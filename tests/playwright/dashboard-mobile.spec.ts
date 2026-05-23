/**
 * Spec: mobile dashboard renders cleanly on phone-class viewports.
 *
 * Phase 2 of task_plan-mobile-copilot.md. Asserts that the operator can
 * manage Nexus from a 375-390px screen without horizontal overflow or
 * collapsed-to-blank-space surfaces.
 *
 * Project scope: this spec is annotated to skip on the `chromium` (desktop)
 * project — the assertions are mobile-specific. Running it on desktop would
 * either fail (sidebar is expanded, KpiGrid is 6-col) or pass for the wrong
 * reasons. The annotation lets `npx playwright test` (all projects) stay
 * green without an explicit `--project` flag.
 *
 * Auth: gated behind requireAuth() like the rest of the suite — when
 * BOT_SESSION_TICKET_URL isn't set, every test is skipped with a clear
 * message rather than failing. Mirrors tests/playwright/_helpers.ts.
 */

import { test, expect } from '@playwright/test'
import { redeemTicket, requireAuth } from './_helpers'

test.describe('mobile dashboard', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // `test.skip(condition, reason)` accepts a runtime boolean — using it
    // inside beforeEach gives us access to testInfo.project.name, which
    // the top-level `test.skip(fn)` predicate signature doesn't expose.
    test.skip(testInfo.project.name === 'chromium', 'desktop project — mobile-specific assertions')
    const auth = requireAuth()
    await redeemTicket(page, auth.ticketUrl)
  })

  test('dashboard fits the viewport without horizontal scroll', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'networkidle' })

    // Page must not be wider than the viewport — horizontal scroll is the
    // single most common mobile regression. The 1px tolerance absorbs sub-px
    // rounding on emulated DPRs.
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

    // The sidebar's outer <aside> uses an inline width style. The auto-collapse
    // hook (Sidebar.tsx — `isNarrow || manualCollapsed`) forces 4rem (64px) on
    // narrow viewports. Anything beyond ~80px means the collapse didn't fire.
    const aside = page.locator('aside').first()
    await expect(aside, 'sidebar <aside> did not render').toBeVisible({ timeout: 5_000 })
    const width = await aside.evaluate(el => (el as HTMLElement).getBoundingClientRect().width)
    expect(width, `sidebar width on mobile should be ≤80px (icon rail); got ${width}px`).toBeLessThanOrEqual(80)
  })

  test('KpiGrid renders as a single column on phone-class viewports', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'networkidle' })

    // Find the first KPI card by locating the unique "vs last month" text and
    // walking up to its grid parent. The grid itself doesn't carry a data
    // attribute today, so we infer it from layout: on iPhone 12 / Pixel 5
    // (390 / 393 px) with grid-cols-1, every card's left edge sits at the
    // same x-coordinate. With grid-cols-2 they'd alternate x-positions.
    const cards = page.locator('[class*="rounded-xl"][class*="p-4"]').filter({ hasText: /vs last month|—|%/ })
    const count = await cards.count()
    test.skip(count < 2, 'fewer than 2 KPI cards rendered — likely a fresh-account dashboard with an alternate CTA')

    const rects = await Promise.all(
      Array.from({ length: Math.min(count, 6) }, (_, i) => cards.nth(i).evaluate(el => (el as HTMLElement).getBoundingClientRect().left)),
    )
    // All cards should align to the same left edge in a single column.
    const distinctLeftEdges = new Set(rects.map(x => Math.round(x))).size
    expect(distinctLeftEdges, `KpiGrid still uses multi-column on mobile — saw ${distinctLeftEdges} distinct left edges across ${rects.length} cards`).toBe(1)
  })
})
