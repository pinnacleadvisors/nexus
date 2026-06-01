/**
 * DESTRUCTIVE smoke (operator-approved 2026-06-01) — real backend, real account.
 * Covers, with cleanup:
 *   1. platform-copilot chat round-trip → dispatch works + no mid-turn logout
 *   2. the agent-activity fix → the chat turn now shows in /api/run-events
 *   3. Slack notification path → POST /api/notifications/test (confirms config state)
 * Cleanup: deletes the chat session it created.
 *
 * Requires BOT_SESSION_TICKET_URL. Skipped otherwise.
 */
import { test, expect, type Page } from '@playwright/test'
import { requireAuth } from './_helpers'

async function redeem(page: Page, ticketUrl: string): Promise<void> {
  await page.goto(ticketUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForURL(u => !u.pathname.startsWith('/sign-in'), { timeout: 45_000 }).catch(() => {})
}

test.setTimeout(300_000)

test('chat round-trip + activity record + slack path (with cleanup)', async ({ page }) => {
  const auth = requireAuth()
  let loggedOut = false
  let armed = false   // only count /sign-in navigations AFTER we're on the chat page
  page.on('framenavigated', f => {
    // A real mid-turn logout redirects to /sign-in?returnUrl=… — NOT the
    // ticket-redemption URL (/sign-in?__clerk_ticket=…). Only count once armed.
    if (armed && f === page.mainFrame() && f.url().includes('/sign-in') && !f.url().includes('__clerk_ticket')) loggedOut = true
  })

  await redeem(page, auth.ticketUrl)
  await page.goto('/manage-platform', { waitUntil: 'domcontentloaded', timeout: 60_000 })

  // Baseline activity count.
  const before = await page.request.get('/api/run-events?limit=200').then(r => r.json()).then(j => (j.rows ?? []).length).catch(() => 0)

  // ── 1. Chat round-trip ──────────────────────────────────────────────────────
  const composer = page.locator('textarea').first()
  await composer.waitFor({ state: 'visible', timeout: 30_000 })
  armed = true   // on the chat page, authed — now any /sign-in redirect is a real logout
  await composer.fill('Reply with exactly the token SMOKE_OK and nothing else.')
  await page.getByRole('button', { name: /^Send$/ }).first().click()

  // Wait for the turn to finish: Send returns (busy lifts) OR an assistant bubble
  // containing our token appears. Generous — cold gateway dispatch.
  await expect(
    page.getByText(/SMOKE_OK/).first().or(page.getByRole('button', { name: /^Send$/ })),
  ).toBeVisible({ timeout: 180_000 })
  expect(loggedOut, 'operator was logged out mid-turn (the bug)').toBe(false)

  // ── 2. Activity fix: the chat turn shows up in the heartbeat feed ────────────
  // gateway_turns is written async after the turn; poll briefly.
  let after = before
  let sawChatTurn = false
  for (let i = 0; i < 10 && !sawChatTurn; i++) {
    await page.waitForTimeout(2000)
    const j = await page.request.get('/api/run-events?limit=200').then(r => r.json()).catch(() => ({ rows: [] }))
    const rows = j.rows ?? []
    after = rows.length
    sawChatTurn = rows.some((r: { event_type?: string; kind?: string }) => r.event_type === 'chat-turn' || r.kind === 'chat-turn')
  }
  console.log(`[smoke] activity rows ${before} → ${after}; sawChatTurn=${sawChatTurn}`)
  expect(sawChatTurn, 'chat turn did not appear in /api/run-events (activity fix)').toBe(true)

  // ── 3. Slack notification path ──────────────────────────────────────────────
  const slack = await page.request.post('/api/notifications/test', {
    data: { channel: 'slack', category: 'security-alert' },
  }).then(async r => ({ status: r.status(), body: await r.json().catch(() => ({})) })).catch(e => ({ status: 0, body: { error: String(e) } }))
  console.log(`[smoke] slack test → HTTP ${slack.status} ${JSON.stringify(slack.body).slice(0, 200)}`)
  // Don't fail on slack — it's expected to be 'unconfigured' until linked. Just report.

  // ── Cleanup: delete the chat session this test created ──────────────────────
  try {
    const sessions = await page.request.get('/api/platform-chat/sessions').then(r => r.json()).catch(() => ({ sessions: [] }))
    const newest = (sessions.sessions ?? [])[0] as { id?: string } | undefined
    if (newest?.id) {
      const del = await page.request.delete(`/api/platform-chat/sessions/${newest.id}`)
      console.log(`[smoke] cleanup: deleted session ${newest.id} → HTTP ${del.status()}`)
    }
  } catch (e) {
    console.log('[smoke] cleanup failed (manual delete may be needed):', e)
  }
})
