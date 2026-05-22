/**
 * Spec: Clerk sign-in renders and accepts credentials.
 *
 * Two modes:
 *
 *   1. Render-only (default, no env required) — navigate to /sign-in and
 *      assert the Clerk widget loads. Catches the class of regressions where
 *      Clerk's CSP is broken, the publishable key is wrong, or proxy.ts
 *      misroutes the sign-in path. Runs everywhere.
 *
 *   2. End-to-end (env: E2E_TEST_USER_EMAIL + E2E_TEST_USER_PASSWORD) — fills
 *      the form, submits, asserts the redirect to a protected route. Skipped
 *      gracefully when env is missing so a developer who just ran `npx
 *      playwright test` doesn't see a red CI mark for missing dev secrets.
 *
 * The sign-in flow is the only spec that runs WITHOUT a Clerk ticket — every
 * other spec uses requireAuth() because they need to be already inside the
 * protected route group.
 */

import { test, expect } from '@playwright/test'

test.describe('sign-in', () => {
  test('renders the Clerk widget', async ({ page }) => {
    const response = await page.goto('/sign-in', { waitUntil: 'domcontentloaded' })
    expect(response, '/sign-in returned no response').not.toBeNull()
    expect(response!.status(), `/sign-in returned HTTP ${response!.status()}`).toBeLessThan(400)

    // Clerk renders its widget inside a div with a `cl-` class prefix. We use
    // a generic locator (any element starting with that prefix) rather than a
    // pinned class name so a Clerk upgrade doesn't break this spec.
    const clerkRoot = page.locator('[class^="cl-"]').first()
    await expect(clerkRoot, 'Clerk widget did not render — check NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and the CSP for challenges.cloudflare.com').toBeVisible({ timeout: 10_000 })

    // The widget should contain either an email input or a social OAuth button
    // depending on the operator's Clerk config. Either is acceptable as proof
    // of life — we just want to know the widget actually mounted.
    const hasInput  = await page.locator('input[type="email"], input[name="identifier"]').count() > 0
    const hasOauth  = await page.locator('button:has-text("Continue"), button:has-text("Google"), button:has-text("GitHub")').count() > 0
    expect(hasInput || hasOauth, 'sign-in widget rendered but has neither email input nor OAuth buttons').toBe(true)
  })

  test('email/password sign-in lands on a protected route', async ({ page }) => {
    const email    = process.env.E2E_TEST_USER_EMAIL
    const password = process.env.E2E_TEST_USER_PASSWORD
    test.skip(!email || !password, 'E2E_TEST_USER_EMAIL + E2E_TEST_USER_PASSWORD not set — skipping live sign-in')

    await page.goto('/sign-in', { waitUntil: 'domcontentloaded' })

    // Clerk's identifier field changed name over versions — accept either.
    const identifierInput = page.locator('input[name="identifier"], input[type="email"]').first()
    await identifierInput.fill(email!)
    await page.locator('button:has-text("Continue"), button[type="submit"]').first().click()

    const passwordInput = page.locator('input[type="password"]').first()
    await passwordInput.waitFor({ state: 'visible', timeout: 10_000 })
    await passwordInput.fill(password!)
    await page.locator('button:has-text("Continue"), button:has-text("Sign in"), button[type="submit"]').first().click()

    // Successful auth lands on /dashboard (or whichever protected page Clerk
    // is configured to redirect to). The exact path doesn't matter; what
    // matters is that we left /sign-in.
    await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 20_000 })
    expect(page.url()).not.toMatch(/\/sign-in/)
  })
})
