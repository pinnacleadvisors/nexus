/**
 * Spec: /health — Health LifeOS domain (migration 102).
 *
 * Verifiable NOW (fail-soft pre-migration): the page renders + GET
 * /api/health/habits returns the 200 contract ({ok, days[], streak}). Once
 * migration 102 is applied, the POST→log→streak flow asserts end-to-end (the
 * conditional block activates when POST returns ok:true).
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

test('health: page renders + habits API contract (+ log flow post-migration)', async ({ page }) => {
  test.setTimeout(240_000)
  const auth = requireAuth()

  await redeemTicketRobust(page, auth.ticketUrl)
  await page.goto(BASE + '/health', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})

  // 1. The page renders the Health LifeOS surface.
  await page.waitForSelector('text=Health', { timeout: 60_000 })
  await page.waitForSelector('text=Log today', { timeout: 30_000 })

  // 2. GET contract — fail-soft 200 even before migration 102.
  const get = await page.evaluate(async () => {
    const r = await fetch('/api/health/habits', { cache: 'no-store' })
    return { status: r.status, body: (await r.json().catch(() => null)) as { ok?: boolean; days?: unknown[]; streak?: number } | null }
  })
  expect(get.status, 'never 5xx (retry-storm rule)').toBeLessThan(500)
  expect(get.body?.ok, 'habits GET ok').toBe(true)
  expect(Array.isArray(get.body?.days), 'days is an array').toBe(true)
  expect(typeof get.body?.streak, 'streak is numeric').toBe('number')

  // 3. Log today — reachable + structured. Full flow asserts once 102 is applied.
  const post = await page.evaluate(async () => {
    const r = await fetch('/api/health/habits', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { logged: true } }),
    })
    return { status: r.status, body: (await r.json().catch(() => null)) as { ok?: boolean } | null }
  })
  expect(post.status, 'POST never 5xx').toBeLessThan(500)
  expect(typeof post.body?.ok, 'POST returns a structured {ok}').toBe('boolean')

  if (post.body?.ok) {
    // Migration 102 applied — the logged day persists + advances the streak.
    const after = await page.evaluate(async () => {
      const r = await fetch('/api/health/habits', { cache: 'no-store' })
      return (await r.json().catch(() => null)) as { days?: Array<{ day: string }>; streak?: number; loggedToday?: boolean } | null
    })
    expect((after?.days ?? []).length, 'a day is logged').toBeGreaterThan(0)
    expect(after?.streak ?? 0, 'streak advanced').toBeGreaterThanOrEqual(1)
    expect(after?.loggedToday, 'today is marked logged').toBe(true)
  }
})
