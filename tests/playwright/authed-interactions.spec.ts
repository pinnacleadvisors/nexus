/**
 * Authenticated interaction smoke — exercises the interactive surfaces beyond
 * first paint (chat compose, board, approvals, business detail) to catch wiring
 * bugs the route-render crawl (authed-explore) can't see.
 *
 * NON-DESTRUCTIVE by design (honours AGENTS.md "no production mutations from the
 * loop"): we type but never send a chat (no paid LLM dispatch), never resolve an
 * approval, never commit a board reorder, never run a fleet action. We assert the
 * affordances are present + wired and that interaction produces no console errors
 * or error boundary.
 *
 * Runs under the `authed` project only.
 */
import { test, expect, type ConsoleMessage } from '@playwright/test'

const IGNORE = [/Computed radius is NaN/i, /LineGeometry/i, /Download the React DevTools/i, /\[Fast Refresh\]/i]

function trackErrors(page: import('@playwright/test').Page): string[] {
  const errs: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (IGNORE.some((re) => re.test(t))) return
    errs.push(t)
  })
  return errs
}

const noErrorBoundary = async (page: import('@playwright/test').Page) =>
  expect(page.getByText(/Application error|Something went wrong|Unhandled Runtime Error/i)).toHaveCount(0)

test.describe('authenticated interactions', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'authed', 'authed project only — run npm run test:e2e:login first')
  })

  test('platform chat: typing enables Send (without dispatching)', async ({ page }) => {
    const errs = trackErrors(page)
    await page.goto('/manage-platform', { waitUntil: 'networkidle' })
    const box = page.locator('textarea').first()
    await expect(box).toBeVisible()
    await box.fill('diagnostic: do not send')
    await expect(box).toHaveValue(/diagnostic/)
    // Send should be actionable once there's text. We do NOT click it.
    const send = page.getByRole('button', { name: /^send$/i })
    await expect(send).toBeEnabled()
    await noErrorBoundary(page)
    expect(errs, `console errors on /manage-platform:\n  ${errs.join('\n  ')}`).toHaveLength(0)
  })

  test('board: renders with filter controls and draggable cards', async ({ page }) => {
    const errs = trackErrors(page)
    await page.goto('/board', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: /Agent Board/i })).toBeVisible()
    // Filter pills are interactive — clicking is a client-side filter (non-mutating).
    await page.getByRole('button', { name: /^Manual$/ }).click()
    await page.getByRole('button', { name: /^All$/ }).click()
    await noErrorBoundary(page)
    expect(errs, `console errors on /board:\n  ${errs.join('\n  ')}`).toHaveLength(0)
  })

  test('approvals: renders cards or a clean empty state', async ({ page }) => {
    const errs = trackErrors(page)
    await page.goto('/approvals', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: /Approvals/i })).toBeVisible()
    await noErrorBoundary(page)
    expect(errs, `console errors on /approvals:\n  ${errs.join('\n  ')}`).toHaveLength(0)
  })

  test('businesses: opening a business loads its detail without error', async ({ page }) => {
    const errs = trackErrors(page)
    await page.goto('/businesses', { waitUntil: 'networkidle' })
    const card = page.locator('a[href^="/businesses/"]').first()
    await expect(card).toBeVisible()
    const href = await card.getAttribute('href')
    await card.click()
    await page.waitForURL(/\/businesses\/.+/, { timeout: 15_000 })
    await page.waitForLoadState('networkidle')
    expect(page.url(), `did not navigate into a business (href was ${href})`).toMatch(/\/businesses\/.+/)
    await noErrorBoundary(page)
    expect(errs, `console errors on business detail:\n  ${errs.join('\n  ')}`).toHaveLength(0)
  })
})
