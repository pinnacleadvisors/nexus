/**
 * Spec: approval cards stay RESOLVED across a reload.
 *
 * Regression guard for the "Approval required · Provision … (N items)" card
 * that re-appeared after the operator had already approved + the actions
 * completed. Root cause: approval resolution lived only in ephemeral React
 * state (message.approval_resolutions), never persisted nor re-derived on
 * reload — unlike edit-plan/edit-self which derive from history. The fix
 * (lib/chat/approval-resolutions.ts) derives approval resolution from the
 * persisted `APPROVAL [<id>]: …` reply.
 *
 * Method: intercept the chat session + messages APIs (route fulfilment — ZERO
 * real backend writes, so this is safe to run against any environment) and
 * return a transcript where the approval was already approved. The card must
 * render as "Approved", and the FloatingActionBar must NOT surface it.
 *
 * Requires BOT_SESSION_TICKET_URL. Skipped otherwise.
 */
import { test, expect, type Page } from '@playwright/test'
import { requireAuth } from './_helpers'

// Robust redemption — the shared redeemTicket() uses waitUntil:'networkidle'
// which HANGS on the Clerk sign-in page (it holds an open polling connection).
// domcontentloaded + waitForURL-off-/sign-in is the reliable pattern.
async function redeemTicketRobust(page: Page, ticketUrl: string): Promise<void> {
  await page.goto(ticketUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForURL(u => !u.pathname.startsWith('/sign-in'), { timeout: 45_000 }).catch(() => { /* may already be signed in */ })
}

const SESSION_ID = '00000000-0000-4000-8000-000000000abc'
const APPROVAL_ID = 'create-business-kaizencraft-regression'

const SESSION_SUMMARY = {
  id: SESSION_ID,
  title: 'Approval persistence regression',
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:05:00.000Z',
  last_message_at: '2026-06-01T00:05:00.000Z',
  message_count: 3,
  inflight_job_id: null,
}

const APPROVAL_REQUEST = {
  title: 'Provision KaizenCraft business (slug: kaizencraft)',
  approval_id: APPROVAL_ID,
  items: [
    { id: '1', label: 'insert business_operators row' },
    { id: '2', label: 'resolve MCP manifest' },
    { id: '3', label: 'create Coolify app' },
    { id: '4', label: 'provision DNS + tunnel' },
  ],
}

// A faithful post-approval transcript: agent emitted the block, operator
// approved all, agent reported completion.
const MESSAGES = [
  { id: 'm1', role: 'user', content: 'create a business: KaizenCraft', metadata: {} },
  { id: 'm2', role: 'assistant', content: 'Here is the provisioning plan.', metadata: { approval_requests: [APPROVAL_REQUEST] } },
  { id: 'm3', role: 'user', content: `APPROVAL [${APPROVAL_ID}]: approve 1,2,3,4`, metadata: {} },
  { id: 'm4', role: 'assistant', content: 'All four items provisioned. KaizenCraft is live.', metadata: {} },
]

test.setTimeout(240_000)   // absorb Turbopack first-compile of /manage-platform

test.beforeEach(async ({ page }) => {
  const auth = requireAuth()
  await redeemTicketRobust(page, auth.ticketUrl)

  // Mock the session list + messages so we control the transcript exactly.
  await page.route('**/api/platform-chat/sessions', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sessions: [SESSION_SUMMARY] }) }))
  await page.route(`**/api/platform-chat/sessions/${SESSION_ID}/messages`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, session: SESSION_SUMMARY, messages: MESSAGES }) }))
})

test('an approved approval renders resolved (not "Approval required") after reload', async ({ page }) => {
  await page.goto('/manage-platform', { waitUntil: 'domcontentloaded', timeout: 60_000 })

  // Open the mocked session from the sidebar.
  await page.getByText('Approval persistence regression').first().click({ timeout: 15_000 }).catch(() => { /* may auto-select */ })

  // The card title should render.
  await expect(page.getByText('Provision KaizenCraft business (slug: kaizencraft)').first())
    .toBeVisible({ timeout: 15_000 })

  // THE ASSERTION: the card must be in its resolved state ("Approved …"), and
  // must NOT show the unresolved "Approval required" header or actionable
  // Approve/Deny buttons. Before the fix, reload lost the resolution and the
  // card re-rendered as "Approval required".
  await expect(page.getByText(/Approved/i).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Approval required')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Approve all|Approve \d+\/\d+|Deny all/ })).toHaveCount(0)
})
