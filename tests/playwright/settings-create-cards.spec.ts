/**
 * Spec: Settings → Agents + Skills "Create" intent cards (sub-plan 6, Group B).
 *
 * Proves the describe→classify→route parity primitive:
 *   1. The Agents tab renders a "Create an agent" card.
 *   2. The Skills tab renders a "Create a skill" card.
 *   3. POST /api/skills/describe is reachable + fail-soft: it returns a
 *      structured 200 ({ok} is a boolean — never a 5xx crash). When the active
 *      LLM provider is configured it classifies (kind ∈ {skill, manual}); when
 *      it isn't (e.g. a local env whose active provider has no API key) it
 *      degrades to {ok:false, error} per the retry-storm rule. Live-classify
 *      correctness is gated on a configured provider (the operator's prod env).
 *
 * Requirements (skips cleanly otherwise): BOT_SESSION_TICKET_URL.
 */

import { test, expect, type Page } from '@playwright/test'
import { requireAuth } from './_helpers'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'

async function redeemTicketRobust(page: Page, ticketUrl: string): Promise<void> {
  await page.goto(ticketUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 45_000 }).catch(() => {})
}

test('settings create cards: agents + skills tabs render + describe classifies', async ({ page }) => {
  test.setTimeout(240_000)
  const auth = requireAuth()

  await redeemTicketRobust(page, auth.ticketUrl)

  // 1. Agents tab — the Create card.
  await page.goto(BASE + '/settings/agents', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})
  await page.waitForSelector('text=Create an agent', { timeout: 60_000 })

  // 2. Skills tab — the Create card.
  await page.goto(BASE + '/settings?tab=skills', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})
  await page.waitForSelector('text=Create a skill', { timeout: 60_000 })

  // 3. The describe endpoint is reachable + fail-soft (structured 200, no 5xx).
  const res = await page.evaluate(async () => {
    const r = await fetch('/api/skills/describe', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ description: 'a skill that computes monthly MRR from a Stripe export' }),
    })
    return { status: r.status, body: (await r.json().catch(() => null)) as { ok?: boolean; kind?: string; error?: string } | null }
  })
  expect(res.status, 'describe endpoint never 5xx-crashes (retry-storm rule)').toBeLessThan(500)
  expect(typeof res.body?.ok, 'describe endpoint returns a structured {ok} response').toBe('boolean')
  if (res.body?.ok) {
    // A provider is configured — classify ran end-to-end.
    expect(['skill', 'manual'], 'valid classification kind').toContain(res.body.kind)
  } else {
    // Provider unconfigured in this env — must degrade gracefully, not crash.
    expect(res.body?.error, 'fail-soft error message present').toBeTruthy()
  }
})
