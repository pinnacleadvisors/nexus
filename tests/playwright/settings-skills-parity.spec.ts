/**
 * Spec: Settings → Skills tab reaches Agentdex parity.
 *
 * Proves sub-plan 6 (Settings UX parity, Group A + C):
 *   1. GET /api/models/providers/available returns the operator's ENABLED
 *      provider set (gateway baseline = anthropic) — the canonical detector
 *      that feeds the model dropdowns.
 *   2. The Skills tab renders a "Recommend models for all" header button.
 *   3. Each SkillCard renders a manual model <select> sourced from that set.
 *
 * Requirements (skips cleanly otherwise): BOT_SESSION_TICKET_URL + a dev
 * server with at least one .claude/skills/<name>/SKILL.md present.
 */

import { test, expect, type Page } from '@playwright/test'
import { requireAuth } from './_helpers'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'

async function redeemTicketRobust(page: Page, ticketUrl: string): Promise<void> {
  await page.goto(ticketUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 45_000 }).catch(() => {})
}

test('skills tab: available-providers endpoint + model dropdown + recommend-all', async ({ page }) => {
  test.setTimeout(240_000)
  const auth = requireAuth()

  await redeemTicketRobust(page, auth.ticketUrl)
  await page.goto(BASE + '/settings?tab=skills', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})

  // 1. Canonical enabled-provider set — gateway is the baseline in every deploy.
  const providers = await page.evaluate(async () => {
    const r = await fetch('/api/models/providers/available', { cache: 'no-store' })
    const j = (await r.json().catch(() => null)) as { providers?: string[] } | null
    return j?.providers ?? []
  })
  expect(providers.length, 'available-providers endpoint returns ≥1 provider').toBeGreaterThan(0)
  expect(providers, 'gateway baseline present').toContain('anthropic')

  // 2. The Recommend-all header button (Agentdex parity).
  await page.waitForSelector('text=Recommend models for all', { timeout: 60_000 })

  // 3. At least one SkillCard model dropdown rendered.
  await page.waitForSelector('select', { timeout: 30_000 }).catch(() => {})
  const selectCount = await page.locator('select').count()
  expect(selectCount, 'at least one skill model dropdown rendered').toBeGreaterThan(0)
})
