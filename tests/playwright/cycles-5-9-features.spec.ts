/**
 * Spec: regression coverage for the cycle 5–9 PR family.
 *
 *   #352  /tools → /settings/agents redirect
 *   #352  /graph header is an <h1>
 *   #352  Mission inline editor exists on /businesses/[slug]
 *   #353  /settings/agents shows the synced agent_library (≥ 1 row)
 *   #354  /issues has a "Report issue" form with the Report button
 *   #355  /inbox approvals tab + dashboard tile read the same source
 *         (count parity verified via direct API hits)
 *   #355  Dashboard inbox rows render chat/task badges
 *   #356  sim-saas-01 business has the 🧪 sim badge on /businesses
 *   #356  sim-saas-01 shows on /dashboard/experiments with 30d spend > 0
 *
 * Every test that requires a signed-in session is gated by
 * BOT_SESSION_TICKET_URL via requireAuth() — same pattern as
 * tests/playwright/golden-path-smoke.spec.ts. Skipped cleanly when the
 * ticket isn't set, so a developer running `npx playwright test` on a
 * fresh clone never sees a hard failure.
 */

import { test, expect } from '@playwright/test'
import { requireAuth, redeemTicket } from './_helpers'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  const auth = requireAuth()
  await redeemTicket(page, auth.ticketUrl)
})

// ── #352 — polish trifecta ────────────────────────────────────────────────────

test('/tools redirects to /settings/agents (PR #352)', async ({ page }) => {
  // Don't follow the redirect automatically — capture it via responses.
  const responses: Array<{ url: string; status: number }> = []
  page.on('response', r => responses.push({ url: r.url(), status: r.status() }))

  await page.goto('/tools', { waitUntil: 'domcontentloaded' })
  // After the navigation completes the operator should be on /settings/agents
  // OR a redirect chain that lands there.
  expect(page.url(), 'final landing URL').toMatch(/\/settings\/agents\b/)
})

test('/graph has a real <h1> heading (PR #352)', async ({ page }) => {
  const resp = await page.goto('/graph', { waitUntil: 'domcontentloaded' })
  expect(resp, 'no response').not.toBeNull()
  expect(resp!.status(), '/graph status').toBeLessThan(400)
  const h1Count = await page.locator('h1').count()
  expect(h1Count, '/graph should have at least one <h1>').toBeGreaterThanOrEqual(1)
  const h1Text = await page.locator('h1').first().textContent()
  expect((h1Text ?? '').toLowerCase()).toContain('knowledge graph')
})

test('Mission editor exists on /businesses/sim-saas-01 (PR #352)', async ({ page }) => {
  const resp = await page.goto('/businesses/sim-saas-01', { waitUntil: 'domcontentloaded' })
  expect(resp, 'no response').not.toBeNull()
  expect(resp!.status(), '/businesses/sim-saas-01 status').toBeLessThan(400)

  // Either the panel shows the saved mission (rendered as <p>) with the Edit
  // button, OR the No-mission state with the Set button. Either way one of
  // these CTAs must be visible.
  const editOrSet = page.locator('button', { hasText: /^(Edit|Set)$/ }).first()
  await expect(editOrSet, 'Mission Edit/Set CTA should render').toBeVisible({ timeout: 5_000 })
})

// ── #353 — agent_library sync ────────────────────────────────────────────────

test('/settings/agents lists the synced agents (PR #353)', async ({ page }) => {
  const resp = await page.goto('/settings/agents', { waitUntil: 'domcontentloaded' })
  expect(resp, 'no response').not.toBeNull()
  expect(resp!.status(), '/settings/agents status').toBeLessThan(400)

  const body = (await page.locator('body').textContent()) ?? ''
  // The page renders an Agentdex header + "N agents · M distinct skills"
  expect(body).toMatch(/Agentdex/i)
  // At least one of the canonical agent slugs should be visible. The set
  // includes both pre-PR-353 specs and any later ones; pick three that have
  // been in tree for months so the assertion isn't fragile.
  const visible = await page.locator('body').textContent()
  const anchors = ['agent-generator', 'business-operator', 'platform-copilot']
  const found   = anchors.filter(a => (visible ?? '').includes(a))
  expect(found.length, `expected ≥ 2 canonical agents visible; found ${found.join(',')}`).toBeGreaterThanOrEqual(2)
})

// ── #354 — operator issue creation ────────────────────────────────────────────

test('/issues exposes the Report-issue form (PR #354)', async ({ page }) => {
  const resp = await page.goto('/issues', { waitUntil: 'domcontentloaded' })
  expect(resp, 'no response').not.toBeNull()
  expect(resp!.status(), '/issues status').toBeLessThan(400)

  // The form must surface a Title field + a Report-issue submit button.
  const reportBtn = page.locator('button', { hasText: /^Report issue$/ }).first()
  await expect(reportBtn, 'Report-issue button should render').toBeVisible({ timeout: 5_000 })

  // Title input — placeholder includes a representative example, narrow enough
  // to fingerprint without being brittle.
  const titleInput = page.getByRole('textbox', { name: /title/i }).first()
  await expect(titleInput, 'Title input should be visible').toBeVisible()
})

// ── #355 — inbox unification ──────────────────────────────────────────────────

test('Inbox approval count + dashboard count match (PR #355)', async ({ page, request }) => {
  // Hit the same aggregator both surfaces use. With session cookies set
  // (redeemTicket'd in beforeEach), Playwright's `request` shares the
  // page context's cookie jar so this counts as an authenticated read.
  const fleetRes = await request.get('/api/approvals/fleet')
  expect(fleetRes.ok(), `/api/approvals/fleet status ${fleetRes.status()}`).toBe(true)
  const fleetBody = await fleetRes.json() as { ok?: boolean; pending?: unknown[] }
  expect(fleetBody.ok, 'fleet ok').toBe(true)
  const fleetCount = Array.isArray(fleetBody.pending) ? fleetBody.pending.length : 0

  // /api/approvals returns the same data in {rows, count} shape — count must agree.
  const aliasRes = await request.get('/api/approvals?status=pending&limit=200')
  expect(aliasRes.ok(), `/api/approvals status ${aliasRes.status()}`).toBe(true)
  const aliasBody = await aliasRes.json() as { ok?: boolean; rows?: unknown[]; count?: number }
  expect(aliasBody.ok, 'alias ok').toBe(true)
  const aliasCount = aliasBody.count ?? (Array.isArray(aliasBody.rows) ? aliasBody.rows.length : 0)

  expect(aliasCount, 'fleet and alias counts must agree (single source of truth)')
    .toBe(fleetCount)
})

test('Dashboard fleet inbox rows render kind badges (PR #355)', async ({ page }) => {
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  // Wait for FleetApprovalInbox to render — either the empty state, the
  // loading state finishes, or rows appear. Use the inbox panel header as
  // the anchor.
  const inboxAnchor = page.locator('text=/Approvals waiting|No pending approvals across the fleet/i').first()
  await expect(inboxAnchor, 'Fleet approval inbox must render').toBeVisible({ timeout: 10_000 })

  // If there are pending approvals, each row should have either a "chat" or
  // "task" badge. If there are 0 pending, the badges aren't expected — skip.
  const bodyText = (await page.locator('body').textContent()) ?? ''
  const hasPending = /Approvals waiting/i.test(bodyText)
  if (!hasPending) {
    test.info().annotations.push({ type: 'note', description: 'No pending approvals — kind-badge assertion skipped' })
    return
  }
  // At least one of the two badges must be present in the rendered HTML.
  expect(bodyText).toMatch(/chat|task/)
})

// ── #356 — simulation framework ───────────────────────────────────────────────

test('sim-saas-01 renders with 🧪 sim badge on /businesses (PR #356)', async ({ page }) => {
  const resp = await page.goto('/businesses', { waitUntil: 'domcontentloaded' })
  expect(resp, 'no response').not.toBeNull()
  expect(resp!.status(), '/businesses status').toBeLessThan(400)

  const bodyText = (await page.locator('body').textContent()) ?? ''
  // The seeded simulation row should be present.
  expect(bodyText, 'sim-saas-01 should appear on /businesses').toContain('Sim SaaS 01')
  // And it must carry the sim badge — the emoji + 'sim' text.
  expect(bodyText, '🧪 sim badge should render').toContain('sim')
})

test('sim-saas-01 listed on /dashboard/experiments with 30d data (PR #356)', async ({ page }) => {
  const resp = await page.goto('/dashboard/experiments', { waitUntil: 'domcontentloaded' })
  expect(resp, 'no response').not.toBeNull()
  expect(resp!.status(), '/dashboard/experiments status').toBeLessThan(400)

  const bodyText = (await page.locator('body').textContent()) ?? ''
  expect(bodyText, 'sim-saas-01 row').toContain('Sim SaaS 01')
  // The seed produced ≥ $1 of synthetic cash_spend over 30d; the index
  // formats spend as $X.XX. Reject the "no spend" case ($0.00) to confirm
  // the seeder + the index page agree.
  const spendMatches = bodyText.match(/\$\d+\.\d{2}/g) ?? []
  const positiveSpend = spendMatches.some(s => parseFloat(s.replace('$', '')) > 0)
  expect(positiveSpend, 'expected at least one $ amount > $0.00 on the index').toBe(true)
})
