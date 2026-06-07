/**
 * Spec: /teams ecosystem binding picker.
 *
 * Proves the registry-driven binding dropdown surfaces the adapters registered
 * in lib/ecosystems/registry.ts — specifically the `code` kind, which gained
 * explicit `claude-code` + `code-codex` bindings (2026-06-07). Because the
 * dropdown is built from `listAllEcosystems().filter(kind)`, a new adapter
 * appears with zero UI changes — this spec guards that contract.
 *
 * Verifies at BOTH the project's configured viewport (the suite runs across
 * desktop + iphone + android projects) so a mobile layout regression in the
 * /teams cards is caught (operator manages from a phone — AGENTS.md checklist).
 *
 * Skips cleanly when:
 *   - BOT_SESSION_TICKET_URL is unset (no auth) — house pattern, skip > throw.
 *   - No team cards exist in this env (binding chips only render for spawned
 *     teams; spawning needs a business, too heavy for a smoke spec).
 */

import { test, expect } from '@playwright/test'
import { requireAuth, redeemTicket } from './_helpers'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'

test.beforeEach(async ({ page }) => {
  const auth = requireAuth()
  await redeemTicket(page, auth.ticketUrl)
})

test('code binding picker lists the explicit gateway adapters', async ({ page }) => {
  await page.goto(`${BASE}/teams`, { waitUntil: 'networkidle' })

  const codeChip = page.locator('[data-testid="binding-chip-code"]').first()
  const chipCount = await codeChip.count()
  test.skip(chipCount === 0, 'no team with a code binding in this env — spawn a team to exercise the picker')

  // Enter edit mode → the registry-driven <select> renders.
  await codeChip.click()
  const picker = page.locator('[data-testid="binding-picker-code"]').first()
  await expect(picker).toBeVisible()

  // The select must offer the values registered for kind=code. Assert on the
  // stable option VALUES (data-adapter-name), not the human labels.
  const values = await picker.locator('option').evaluateAll(
    opts => opts.map(o => o.getAttribute('data-adapter-name')),
  )
  expect(values).toEqual(expect.arrayContaining(['open-code', 'aider', 'claude-code', 'code-codex']))

  // Rebinding to the new explicit adapter must be selectable.
  await picker.selectOption('claude-code')
})
