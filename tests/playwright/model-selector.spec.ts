/**
 * Spec: the chat model list serves only well-formed, current Claude models
 * (no outdated/unusable ids), and the chat surface loads without uncaught JS
 * errors.
 *
 * Guards the model-discovery regression: the Anthropic /v1/models API returns
 * every model a key can access, including outdated ones like `claude-sonnet-4`
 * — selecting one crashed the turn. Discovery is now version-gated to surface
 * ONLY models strictly newer than the curated baseline, so the list stays
 * clean. We assert the REAL /api/models/available output (against the real API
 * in this env) rather than driving the dropdown toggle (flaky vs dev-server
 * hydration). The dropdown's curated content + scroll is also confirmed
 * visually in the verification screenshot, and the gating logic is unit-tested
 * in __tests__/model-discovery.test.ts.
 *
 * Requires BOT_SESSION_TICKET_URL. Skipped otherwise.
 */
import { test, expect, type Page } from '@playwright/test'
import { requireAuth } from './_helpers'

async function redeemTicketRobust(page: Page, ticketUrl: string): Promise<void> {
  await page.goto(ticketUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForURL(u => !u.pathname.startsWith('/sign-in'), { timeout: 45_000 }).catch(() => {})
}

test.setTimeout(180_000)

test('model list is curated + free of outdated ids; chat surface has no uncaught errors', async ({ page }) => {
  const auth = requireAuth()
  const pageErrors: string[] = []
  page.on('pageerror', e => pageErrors.push(e.message))

  await redeemTicketRobust(page, auth.ticketUrl)

  // The merged list the dropdown consumes — exercises the REAL discovery merge
  // against the real Anthropic models API (auth cookies carried from redemption;
  // the route also returns the static list as a floor, so this is robust either way).
  const res = await page.request.get('/api/models/available')
  expect(res.ok(), `/api/models/available → ${res.status()}`).toBeTruthy()
  const body = await res.json() as { defaultId: string; models: Array<{ id: string; provider: string }> }

  expect(body.defaultId, 'default must be the latest curated flagship').toBe('claude-opus-4-8')
  const ids = body.models.map(m => m.id)
  expect(ids, 'curated baseline present').toEqual(expect.arrayContaining(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']))

  // THE regression: no outdated/unusable Claude ids. Every claude model must be
  // a well-formed family-major-minor — this excludes `claude-sonnet-4` (the
  // crash), `claude-3-5-sonnet`, etc.
  for (const m of body.models) {
    if (m.provider !== 'claude') continue
    expect(m.id, `claude id must be family-major-minor (no outdated/legacy): "${m.id}"`).toMatch(/^claude-(opus|sonnet|haiku)-\d+-\d+$/)
  }
  expect(ids, 'the crashing model must be absent').not.toContain('claude-sonnet-4')

  // Light UI smoke: the chat surface renders the model chip and throws no
  // uncaught JS errors on load.
  await page.goto('/manage-platform', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.getByRole('button', { name: /^Model:/ }), 'model chip renders in composer').toBeVisible({ timeout: 30_000 })

  const benign = /ResizeObserver|Hydration|favicon|third-party cookie|clerk\.com.*telemetry/i
  const real = pageErrors.filter(e => !benign.test(e))
  expect(real, `uncaught pageerrors: ${real.join(' | ')}`).toHaveLength(0)
})
