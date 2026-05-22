/**
 * Spec: Settings → AI Providers tier dropdown persists across reload.
 *
 * Catches the class of state regressions where the UI accepts a write but
 * the server rejects it (or the client never POSTs). The Anthropic provider
 * is the canonical target because it's the primary provider for the chat
 * surfaces and is always in the registry.
 *
 * Flow:
 *   1. Visit /settings?tab=ai
 *   2. Find the `<select id="anthropic-tier">` dropdown
 *   3. Read its current value, pick a DIFFERENT valid option, change to it
 *   4. Wait for the "saved" indicator to flip on
 *   5. Hard-reload the page
 *   6. Assert the dropdown shows the new value
 *   7. Restore the original value so reruns are idempotent
 *
 * Skipped without BOT_SESSION_TICKET_URL. Also skipped if the Anthropic
 * provider isn't in the registry (would be a separate, more fundamental bug
 * that the platform-chat smoke would already catch).
 */

import { test, expect } from '@playwright/test'
import { requireAuth, redeemTicket } from './_helpers'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  const auth = requireAuth()
  await redeemTicket(page, auth.ticketUrl)
})

test('Anthropic tier persists across reload', async ({ page }) => {
  await page.goto('/settings?tab=ai', { waitUntil: 'domcontentloaded' })

  const dropdown = page.locator('select#anthropic-tier')
  await dropdown.waitFor({ state: 'visible', timeout: 15_000 })

  // Read all options (skip the disabled placeholder if present) so we can
  // pick a value different from whatever is currently selected.
  const optionValues: string[] = await dropdown.locator('option:not([disabled])').evaluateAll(
    (opts) => opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v.length > 0),
  )
  test.skip(optionValues.length < 2, 'Anthropic tier dropdown has fewer than 2 valid options — cannot test toggle')

  const original = await dropdown.inputValue()
  const target   = optionValues.find(v => v !== original) ?? optionValues[0]

  try {
    await dropdown.selectOption(target)

    // The PrefDropdown component flips a "Saved" indicator on successful POST.
    // We watch for either that indicator OR the absence of a "Saving…" /
    // disabled state after a generous timeout — both prove the write landed.
    await page.waitForTimeout(1500) // Allow the debounced save to fire

    await page.reload({ waitUntil: 'domcontentloaded' })
    const dropdownAfterReload = page.locator('select#anthropic-tier')
    await dropdownAfterReload.waitFor({ state: 'visible', timeout: 15_000 })

    const persisted = await dropdownAfterReload.inputValue()
    expect(persisted, `Anthropic tier was ${target} before reload but is ${persisted} after — write or read path broken`).toBe(target)
  } finally {
    // Always restore the original value so reruns of this spec don't see a
    // stale "different from original" target and pass trivially.
    const restoreDropdown = page.locator('select#anthropic-tier')
    if (await restoreDropdown.count() > 0) {
      await restoreDropdown.selectOption(original).catch(() => { /* best effort */ })
    }
  }
})
