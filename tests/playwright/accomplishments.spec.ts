/**
 * Spec: /accomplishments — the Wins board (Gamify sub-plan, read-path v1).
 *
 * Proves:
 *   1. GET /api/accomplishments returns a structured 200 board ({ok:true} with
 *      a non-empty achievements[] + numeric operatorLevel) computed from real
 *      revenue — never a 5xx (retry-storm rule).
 *   2. The page renders the Wins header + operator-level track.
 *
 * Deterministic regardless of whether the operator has revenue (8 tiers are
 * always returned; locked when no revenue). Requirements: BOT_SESSION_TICKET_URL.
 */

import { test, expect, type Page } from '@playwright/test'
import { requireAuth } from './_helpers'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'

async function redeemTicketRobust(page: Page, ticketUrl: string): Promise<void> {
  await page.goto(ticketUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 45_000 }).catch(() => {})
}

test('accomplishments: api returns tiers + page renders the wins board', async ({ page }) => {
  test.setTimeout(240_000)
  const auth = requireAuth()

  await redeemTicketRobust(page, auth.ticketUrl)
  await page.goto(BASE + '/accomplishments', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})

  // 1. The read API — structured 200 board from real revenue.
  const api = await page.evaluate(async () => {
    const r = await fetch('/api/accomplishments', { cache: 'no-store' })
    return { status: r.status, body: (await r.json().catch(() => null)) as { ok?: boolean; achievements?: unknown[]; operatorLevel?: number } | null }
  })
  expect(api.status, 'never 5xx (retry-storm rule)').toBeLessThan(500)
  expect(api.body?.ok, 'board evaluated ok').toBe(true)
  expect(Array.isArray(api.body?.achievements), 'achievements is an array').toBe(true)
  expect((api.body?.achievements ?? []).length, 'tiers present').toBeGreaterThan(0)
  expect(typeof api.body?.operatorLevel, 'operatorLevel is numeric').toBe('number')

  // 2. The page renders the board.
  await page.waitForSelector('text=Wins', { timeout: 60_000 })
  await page.waitForSelector('text=Operator level', { timeout: 30_000 })
})
