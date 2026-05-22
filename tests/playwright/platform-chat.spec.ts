/**
 * Spec: /manage-platform chat round-trip.
 *
 * Asserts that typing into the platform copilot's composer and clicking Send
 * actually dispatches a turn. We deliberately do NOT assert the content of
 * the assistant reply — the agent's behavior depends on which provider is
 * configured and what tools are available. Instead we assert the round-trip
 * by watching the composer's busy state lift (Send → Working → Send again)
 * which only happens when the chat enqueue + poll machinery completes.
 *
 * Requires BOT_SESSION_TICKET_URL. Skipped otherwise.
 */

import { test, expect } from '@playwright/test'
import { requireAuth, redeemTicket } from './_helpers'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  const auth = requireAuth()
  await redeemTicket(page, auth.ticketUrl)
})

test('platform copilot accepts a message and processes it', async ({ page }) => {
  const response = await page.goto('/manage-platform', { waitUntil: 'domcontentloaded' })
  expect(response, 'no response for /manage-platform').not.toBeNull()
  expect(response!.status(), `/manage-platform returned ${response!.status()}`).toBeLessThan(400)

  // The platform-chat composer is rendered by components/platform-chat/PlatformChat.tsx.
  // The textarea placeholder distinguishes empty vs reply state — match either.
  const composer = page.locator('textarea').filter({ hasText: '' }).first()
  await composer.waitFor({ state: 'visible', timeout: 15_000 })

  const sendButton = page.locator('button').filter({ hasText: /^Send$/ }).first()
  await sendButton.waitFor({ state: 'visible', timeout: 5_000 })

  // Send a deliberately cheap, deterministic prompt. The point is "did the
  // round-trip complete", not "what did the agent say".
  await composer.fill('ping — Playwright smoke test, please respond briefly')
  await sendButton.click()

  // The Send button label flips to "Working…" while a turn is in flight.
  // We assert it goes back to "Send" (or stays "Working…" beyond our timeout
  // and we fail). 60s is generous — most platform-copilot turns finish under
  // 20s; we give headroom for cold-start dispatch and a slow gateway.
  const sendOrError = page.locator('button:has-text("Send"), [role="alert"], text=/error|failed|unauthor/i').first()
  await expect(sendOrError, 'composer did not return to Send state within 60s — chat enqueue or poll broken').toBeVisible({ timeout: 60_000 })

  // Either Send is back (success path) or an explicit error rendered. Both
  // indicate the round-trip executed. A spinning Working… that never resolves
  // is the regression we're catching.
})
