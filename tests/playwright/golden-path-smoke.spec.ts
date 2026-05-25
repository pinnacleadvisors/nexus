/**
 * Spec: read-only operator golden-path smoke.
 *
 * Walks the operator's first-day path across every key protected route,
 * asserting each page loads and renders an expected anchor. This is the
 * "did the v8–v14 stacked PR family break anything operator-facing?"
 * canary — fast, no side effects, no provisioning.
 *
 * Pages exercised (in operator-flow order):
 *   1. /dashboard        — landing
 *   2. /create-business  — consultant agent chat surface
 *   3. /settings/accounts — connected-accounts manager
 *   4. /board            — kanban board with first-tick cards
 *   5. /cron-health      — fleet health surface (added v6+)
 *   6. /teams            — department / ecosystem org chart
 *   7. /manage-platform  — operator copilot console
 *
 * Each page is asserted at BOTH 1280px (laptop) and 375px (iPhone) so
 * the mobile-copilot AGENTS.md rule is mechanically enforced.
 *
 * Destructive verbs (creating a business, connecting an account, firing
 * a cron tick) are NOT exercised — they belong to docs/runbooks/
 * e2e-golden-path-walkthrough.md as a human-driven smoke. This spec
 * only catches "did the page break", not "does the create-business agent
 * give a sensible reply".
 *
 * Skipped when BOT_SESSION_TICKET_URL is not set — same gate as every
 * other spec in this suite.
 */

import { test, expect, type Page } from '@playwright/test'
import { requireAuth, redeemTicket } from './_helpers'

interface ProtectedRoute {
  /** URL path (no host). */
  path:    string
  /** Substring or regex of an expected anchor in the page body. */
  anchor:  string | RegExp
  /** Human-readable label for failure messages. */
  label:   string
  /** Set to true if the route is known-flaky and should soft-skip on miss. */
  optional?: boolean
}

const ROUTES: ProtectedRoute[] = [
  { path: '/dashboard',         label: 'Dashboard',         anchor: /Dashboard|Welcome|KPI|business/i },
  { path: '/create-business',   label: 'Create-business',   anchor: /create.+business|consultant|niche|brand voice/i },
  { path: '/settings/accounts', label: 'Settings/Accounts', anchor: /connected.+account|composio|connect via/i },
  { path: '/board',             label: 'Board',             anchor: /board|column|review|in.?progress|completed/i },
  { path: '/cron-health',       label: 'Cron health',       anchor: /cron|schedule|last.+run|fleet|health/i },
  { path: '/teams',             label: 'Teams',             anchor: /team|department|spawn|ecosystem|engineering|content/i },
  { path: '/manage-platform',   label: 'Manage-platform',   anchor: /platform|copilot|console|audit|cost.guard/i },
]

const VIEWPORTS = [
  { width: 1280, height: 800,  label: 'laptop' },
  { width: 375,  height: 812,  label: 'iphone' },
] as const

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  const auth = requireAuth()
  await redeemTicket(page, auth.ticketUrl)
})

for (const route of ROUTES) {
  for (const vp of VIEWPORTS) {
    test(`${route.label} renders at ${vp.label} (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      const resp = await page.goto(route.path, { waitUntil: 'domcontentloaded' })

      expect(resp, `no response for ${route.path}`).not.toBeNull()
      expect(
        resp!.status(),
        `${route.label} ${route.path} returned HTTP ${resp!.status()} at ${vp.label}`,
      ).toBeLessThan(400)

      // Anchor: at least one text node matching the expected pattern.
      await assertAnchor(page, route)

      // Mobile-overflow sanity — document scrollWidth should be ≤ viewport+12px
      // (12px tolerance for scrollbars / floating-point rounding).
      if (vp.width <= 400) {
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
        expect(
          scrollWidth,
          `${route.label} ${route.path} causes horizontal scroll at ${vp.label} (scrollWidth=${scrollWidth}, viewport=${vp.width}). ` +
          'Suspected layout-class regression — see AGENTS.md mobile-copilot rule.',
        ).toBeLessThanOrEqual(vp.width + 12)
      }
    })
  }
}

async function assertAnchor(page: Page, route: ProtectedRoute): Promise<void> {
  // Try anchor against body text — common patterns the operator should see.
  const bodyText = await page.locator('body').textContent({ timeout: 15_000 })
  const matched =
    route.anchor instanceof RegExp
      ? route.anchor.test(bodyText ?? '')
      : (bodyText ?? '').toLowerCase().includes((route.anchor as string).toLowerCase())

  if (!matched && route.optional) {
    test.info().annotations.push({
      type: 'soft-skip',
      description: `${route.label}: anchor not matched but route is marked optional`,
    })
    return
  }

  expect(
    matched,
    `${route.label} ${route.path} loaded but expected anchor (${route.anchor}) not found. ` +
    `Body excerpt: ${(bodyText ?? '').slice(0, 200).replace(/\s+/g, ' ').trim()}`,
  ).toBe(true)
}
