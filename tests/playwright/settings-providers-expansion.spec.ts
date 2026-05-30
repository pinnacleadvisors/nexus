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

import { test, expect } from '@playwright/test'
import { requireAuth, redeemTicket } from './_helpers'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  const auth = requireAuth()
  await redeemTicket(page, auth.ticketUrl)
})

test('AI Providers tab shows NIM + Ollama cards', async ({ page }) => {
  await page.goto('/settings?tab=ai', { waitUntil: 'domcontentloaded' })

  // The provider grid renders card names from AI_PROVIDERS. Both new entries
  // must be present.
  await expect(page.getByText('NVIDIA NIM', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Ollama', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
})

test('Agentdex renders agent cards with a populated model picker', async ({ page }) => {
  await page.goto('/settings/agents', { waitUntil: 'domcontentloaded' })

  // At least one agent card with a model <select>. The select must have
  // options — an empty dropdown would mean the provider-detection collapsed.
  const firstSelect = page.locator('select').first()
  await firstSelect.waitFor({ state: 'visible', timeout: 15_000 })
  const optionCount = await firstSelect.locator('option').count()
  expect(optionCount).toBeGreaterThan(0)
})
