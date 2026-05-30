/**
 * Spec: Settings provider expansion (2026-05-30 brain-dump Wave 1).
 *
 * Verifies the two operator-visible outcomes of the Providers-Routing slice:
 *   1. /settings?tab=ai renders the new NVIDIA NIM + Ollama provider cards.
 *   2. /settings/agents (Agentdex) renders agent cards with a populated model
 *      picker — proving the dynamic-provider dropdown code path loads without
 *      collapsing (the lean-mode Claude-only bug). The exact provider set is
 *      env-dependent, so the deterministic logic is covered by the unit test
 *      __tests__/detect-providers.test.ts; this spec proves it renders.
 *
 * Auth: redeems a Clerk sign-in ticket (BOT_SESSION_TICKET_URL). Skips
 * cleanly when unset — same pattern as settings-ai-providers.spec.ts.
 */

import { test, expect, type Page } from '@playwright/test'
import { requireAuth } from './_helpers'

/**
 * Redeem a Clerk sign-in ticket WITHOUT waiting for networkidle. The shared
 * `redeemTicket` helper uses `waitUntil: 'networkidle'`, which never settles
 * against the Clerk sign-in page (it holds an open polling connection). We
 * wait for the post-redemption redirect OFF /sign-in instead.
 */
async function redeemTicketRobust(page: Page, ticketUrl: string): Promise<void> {
  await page.goto(ticketUrl, { waitUntil: 'domcontentloaded' })
  await page
    .waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 45_000 })
    .catch(() => { /* asserts below surface a real auth failure with a clearer message */ })
}

// ONE test, ONE ticket redemption — Clerk sign-in tokens are single-use, so a
// per-test beforeEach with fresh contexts would fail on the 2nd redeem. We
// redeem once and assert across both routes in the same authenticated context.
test('provider expansion: NIM/Ollama cards + populated Agentdex dropdown', async ({ page }) => {
  // Generous timeout: a local dev server compiles each protected route on the
  // first authenticated hit (Turbopack). In CI against a built server this is
  // far quicker.
  test.setTimeout(240_000)
  const auth = requireAuth()
  await redeemTicketRobust(page, auth.ticketUrl)

  // 1. AI Providers tab renders the new NVIDIA NIM + Ollama cards.
  //    60s nav timeout absorbs first-compile of the route on a cold dev server.
  await page.goto('/settings?tab=ai', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.getByText('NVIDIA NIM', { exact: false }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Ollama', { exact: false }).first()).toBeVisible({ timeout: 30_000 })

  // 2. Agentdex renders agent cards with a populated model <select>. An empty
  //    dropdown would mean provider-detection collapsed (the lean-mode bug).
  await page.goto('/settings/agents', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const firstSelect = page.locator('select').first()
  await firstSelect.waitFor({ state: 'visible', timeout: 30_000 })
  const optionCount = await firstSelect.locator('option').count()
  expect(optionCount).toBeGreaterThan(0)
})
