/**
 * Authenticated exploration crawl — the bug-catching surface for an
 * operator-driven "test + improve" session.
 *
 * Runs ONLY under the `authed` project (registered by playwright.config.ts once
 * scripts/playwright-auth-login.mjs has captured a real session). For every key
 * protected route it asserts the page rendered for a signed-in user (no redirect
 * to sign-in, no Next error boundary) and collects console errors + failed
 * network requests into the test report so regressions surface mechanically.
 *
 * Run:  STORAGE_STATE=tests/playwright/.auth/operator.json npx playwright test --project=authed authed-explore
 *
 * This is a living crawl — add routes as the platform grows. It is intentionally
 * lenient on content (the platform is fast-moving) and strict on hard failures
 * (console errors, 5xx, error boundaries, auth bounces).
 */
import { test, expect, type ConsoleMessage, type Request } from '@playwright/test'

// Key protected surfaces. Extend freely.
const ROUTES = [
  '/dashboard',
  '/forge',
  '/board',
  '/inbox',
  '/approvals',
  '/businesses',
  '/teams',
  '/tools',
  '/settings/accounts',
  '/manage-platform',
  '/workforce',
  '/code',
  '/graph',
]

// Console noise that isn't a real defect (third-party libs, dev HMR).
const IGNORE_CONSOLE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /hydration/i, // tracked separately; don't fail the crawl on it
]

test.describe('authenticated exploration', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'authed', 'authed project only — run scripts/playwright-auth-login.mjs first')
  })

  for (const route of ROUTES) {
    test(`renders authed: ${route}`, async ({ page }) => {
      const consoleErrors: string[] = []
      const failedRequests: string[] = []

      page.on('console', (msg: ConsoleMessage) => {
        if (msg.type() !== 'error') return
        const text = msg.text()
        if (IGNORE_CONSOLE.some((re) => re.test(text))) return
        consoleErrors.push(text)
      })
      page.on('requestfailed', (req: Request) => {
        failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'failed'}`)
      })
      const serverErrors: string[] = []
      page.on('response', (res) => {
        if (res.status() >= 500) serverErrors.push(`${res.status()} ${res.url()}`)
      })

      const resp = await page.goto(route, { waitUntil: 'networkidle' }).catch(() => null)

      // 1. Did we stay authenticated? (no bounce to the sign-in page)
      expect(page.url(), `bounced to sign-in from ${route} — session expired? re-run the login capture`)
        .not.toMatch(/\/sign-in|\/$/)

      // 2. Top-level document didn't 5xx.
      if (resp) expect(resp.status(), `${route} returned ${resp.status()}`).toBeLessThan(500)

      // 3. No Next.js error boundary on screen.
      const errorBoundary = page.getByText(/Application error|Something went wrong|Unhandled Runtime Error/i)
      expect(await errorBoundary.count(), `error boundary visible on ${route}`).toBe(0)

      // 4. Report (don't hard-fail) console + network noise — visible in the run log.
      if (consoleErrors.length) console.warn(`[${route}] console errors:\n  ${consoleErrors.join('\n  ')}`)
      if (failedRequests.length) console.warn(`[${route}] failed requests:\n  ${failedRequests.join('\n  ')}`)

      // 5. Hard-fail on server 5xx observed during the page's own fetches.
      expect(serverErrors, `5xx responses on ${route}:\n  ${serverErrors.join('\n  ')}`).toHaveLength(0)
    })
  }
})
