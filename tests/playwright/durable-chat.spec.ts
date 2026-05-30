/**
 * Spec: durable chat — a turn survives the tab closing (migration 099, Phase A+B).
 *
 * Proves the core guarantee: the browser NEVER calls /api/platform-chat/poll,
 * yet the assistant reply still lands in chat_messages — drained server-side by
 * the reconciler. Flow:
 *   1. Enqueue a turn (browser holds the jobId+sessionId, does NOT poll).
 *   2. Trigger /api/cron/chat-turn-drain from the test (Node) until it drains.
 *   3. GET the session messages in-page → assert the assistant reply is there.
 *
 * Cheap-model testing: the turn runs on Haiku via `modelOverride` (the resolver
 * plumbs it to the gateway's --model), so a full run is ~20x cheaper than Opus.
 * Override with TEST_CHAT_MODEL.
 *
 * Requirements (skips cleanly otherwise): BOT_SESSION_TICKET_URL (auth) +
 * CRON_SECRET (reconciler) + migration 099 applied + a reachable gateway.
 */

import { test, expect, type Page } from '@playwright/test'
import { requireAuth } from './_helpers'

/** Cheap model for chat testing — Haiku by default. The model id flows through
 *  `modelOverride` → gateway `--model`, so no platform change is needed. */
const TEST_CHAT_MODEL = process.env.TEST_CHAT_MODEL ?? 'claude-haiku-4-5'
const BASE = process.env.BASE_URL ?? 'http://localhost:3100'

async function redeemTicketRobust(page: Page, ticketUrl: string): Promise<void> {
  await page.goto(ticketUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 45_000 }).catch(() => {})
}

test('a chat turn persists even though the browser never polls', async ({ page }) => {
  test.setTimeout(240_000)
  const auth = requireAuth()
  const cronSecret = process.env.CRON_SECRET
  test.skip(!cronSecret, 'CRON_SECRET not set — needed to trigger the reconciler')

  await redeemTicketRobust(page, auth.ticketUrl)
  await page.goto(BASE + '/manage-platform', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})

  // 1. Enqueue a turn on Haiku. The browser deliberately does NOT poll it.
  const enq = await page.evaluate(async (model) => {
    const r = await fetch('/api/platform-chat', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({
        messages:      [{ role: 'user', content: 'Reply with exactly one word: DURABLE' }],
        modelOverride: model,
      }),
    })
    return (await r.json().catch(() => null)) as { ok?: boolean; jobId?: string; sessionId?: string } | null
  }, TEST_CHAT_MODEL)

  expect(enq?.ok, 'enqueue succeeded').toBe(true)
  expect(enq?.jobId, 'got a jobId').toBeTruthy()
  const sessionId = enq!.sessionId!
  expect(sessionId, 'got a sessionId').toBeTruthy()

  // 2. Drive the reconciler from Node (browser never touches /poll) until the
  //    assistant reply has been persisted server-side.
  let assistantReply: string | null = null
  for (let i = 0; i < 30 && assistantReply === null; i++) {
    await page.waitForTimeout(4_000)
    await fetch(BASE + '/api/cron/chat-turn-drain', {
      method:  'POST',
      headers: { Authorization: `Bearer ${cronSecret}` },
    }).catch(() => {})
    // Read the session's messages in-page (carries the auth cookie).
    const msgs = await page.evaluate(async (sid) => {
      const r = await fetch('/api/platform-chat/sessions/' + sid + '/messages', { cache: 'no-store' })
      const j = (await r.json().catch(() => null)) as { messages?: Array<{ role: string; content: string }> } | null
      return j?.messages ?? []
    }, sessionId)
    const reply = msgs.find((m) => m.role === 'assistant' && (m.content ?? '').trim().length > 0)
    if (reply) assistantReply = reply.content
  }

  // 3. The reply was persisted with NO browser poll — durable chat works.
  expect(assistantReply, 'assistant reply persisted by the reconciler (no browser poll)').toBeTruthy()
})
