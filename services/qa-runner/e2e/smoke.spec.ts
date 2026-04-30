/**
 * Tier 1 smoke spec — drive the bot user through the core protected pages
 * after a deploy. Goal is fast (<60 s on a clean run), bounded (5 routes),
 * and noisy on every category of UI regression we care about:
 *
 *   1. Status: page returns 2xx (no 404 / 500)
 *   2. Render: a recognisable heading/landmark exists (catches "white page"
 *      regressions where Next.js serves a blank shell + client-side error)
 *   3. Console: no errors in the browser console (catches Hydration
 *      mismatches, missing icons from lucide-react, undefined refs)
 *   4. Network: no 5xx responses on any sub-request (catches API failures
 *      that the page itself swallows visually)
 *
 * Auth: the orchestrator sets `BOT_SESSION_TICKET_URL` before invoking
 * `playwright test`. The fixture below redeems the ticket once per spec
 * and reuses the cookie across page navigations.
 */

import { test, expect, type ConsoleMessage, type Response } from '@playwright/test'

interface RouteCheck {
  /** Path under `BASE_URL` */
  path:    string
  /** A regex that should match a top-level heading or landmark on the page. */
  heading: RegExp
  /** Optional extra wait — for routes that finish loading async data after `load`. */
  settleMs?: number
}

const ROUTES: RouteCheck[] = [
  { path: '/dashboard', heading: /dashboard|operations|kpi|revenue/i, settleMs: 1_000 },
  { path: '/forge',     heading: /forge|idea|chat/i },
  { path: '/board',     heading: /board|kanban|review/i, settleMs: 500 },
  { path: '/tools',     heading: /tools|integrations|connections/i },
  { path: '/graph',     heading: /graph|memory|knowledge/i, settleMs: 1_000 },
]

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  const ticketUrl = process.env.BOT_SESSION_TICKET_URL
  if (!ticketUrl) {
    throw new Error('BOT_SESSION_TICKET_URL is not set — orchestrator must mint a Clerk sign-in ticket before running specs')
  }
  await page.goto(ticketUrl, { waitUntil: 'networkidle' })
  // Once the ticket is redeemed Clerk redirects to the dashboard. Wait for
  // the resulting Clerk session cookie before any route check runs.
  await page.waitForURL(/\/(dashboard|forge|board)/, { timeout: 15_000 }).catch(() => {
    // Fall through — some Clerk configurations land on `/` after redemption.
  })
})

for (const route of ROUTES) {
  test(`smoke: ${route.path}`, async ({ page }) => {
    const consoleErrors: string[] = []
    const networkErrors: string[] = []

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        const text = msg.text()
        // Filter out noise we explicitly tolerate. Add to this list sparingly
        // — false negatives here defeat the spec's purpose.
        if (text.includes('favicon')) return
        if (text.includes('Failed to load resource: the server responded with a status of 401')) return
        consoleErrors.push(text)
      }
    })

    page.on('response', (resp: Response) => {
      const status = resp.status()
      const url    = resp.url()
      if (status >= 500 && !url.includes('/_next/')) {
        networkErrors.push(`${status} ${url}`)
      }
    })

    const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' })
    expect(response, `no response for ${route.path}`).not.toBeNull()
    expect(response!.status(), `${route.path} returned ${response!.status()}`).toBeLessThan(400)

    if (route.settleMs) await page.waitForTimeout(route.settleMs)

    // Heading check — accept any heading level so re-organising the layout
    // doesn't break the spec, just the absence of meaningful text does.
    const text = (await page.locator('main, body').first().innerText()).slice(0, 4000)
    expect(text, `${route.path} content did not match ${route.heading}`).toMatch(route.heading)

    expect(consoleErrors, `${route.path} produced console errors`).toEqual([])
    expect(networkErrors, `${route.path} produced 5xx responses`).toEqual([])
  })
}
