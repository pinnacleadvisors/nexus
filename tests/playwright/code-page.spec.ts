/**
 * /code page (authenticated). The claudecodeui engine is embedded when reachable,
 * but must degrade gracefully when it isn't (the common case until it's deployed
 * behind the tunnel — previously rendered a blank/broken iframe). See CodeEmbed.tsx.
 *
 * On this dev box claudecodeui is NOT deployed, so the reachability probe resolves
 * to "down" and we assert the graceful panel + the preserved governance rail.
 * If you later run claudecodeui locally, this spec's "down" assertions won't hold
 * — that's expected; the iframe path takes over.
 *
 * Runs under the `authed` project only.
 */
import { test, expect } from '@playwright/test'

test.describe('/code page', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'authed', 'authed project only — run npm run test:e2e:login first')
  })

  test('renders without an error boundary and keeps the governance rail', async ({ page }) => {
    await page.goto('/code', { waitUntil: 'networkidle' })
    await expect(page.getByText(/Application error|Something went wrong|Unhandled Runtime Error/i)).toHaveCount(0)
    // Preserved rail survives the engine swap (ADR 013). Match the rail cards by
    // their unique sub-text (the /board + /approvals hrefs also appear in the
    // sidebar nav, so scope by content not href).
    await expect(page.getByText('Gate decisions')).toBeVisible()
    await expect(page.getByText('Manual + background tasks')).toBeVisible()
  })

  test('degrades gracefully when claudecodeui is unreachable', async ({ page }) => {
    await page.goto('/code', { waitUntil: 'networkidle' })
    // Wait out the 6s reachability probe.
    await page.waitForTimeout(7000)
    // Either it connected (iframe) or it shows the graceful panel — never a blank
    // void. On a box without claudecodeui we get the panel + a Retry affordance.
    const panel = page.getByText(/isn.t connected yet/i)
    const iframe = page.locator('iframe[title="claudecodeui"]')
    const hasPanel = await panel.count()
    const hasIframe = await iframe.count()
    expect(hasPanel + hasIframe, 'neither the embed nor the fallback panel rendered').toBeGreaterThan(0)
    if (hasPanel) {
      await expect(page.getByRole('button', { name: /retry/i })).toBeVisible()
    }
  })
})
