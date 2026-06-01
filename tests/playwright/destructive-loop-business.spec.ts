/**
 * DESTRUCTIVE test (operator-approved) — Loop + Business create/verify/DELETE.
 *
 * Both surfaces lack a DELETE API, so cleanup uses a direct service-role Supabase
 * delete in a finally block (guaranteed teardown, even if an assertion fails).
 * The Business is created ROW-ONLY via wizard/create (simulation mode) — it does
 * NOT fire the Coolify/DNS/Composio provisioning (the irreversible part), so
 * there is zero cloud infra to orphan.
 *
 * Run under `doppler run` so SUPABASE_SERVICE_ROLE_KEY is present for cleanup.
 * Requires BOT_SESSION_TICKET_URL. Skipped otherwise.
 */
import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './_helpers'

const STAMP    = Date.now().toString(36)
const LOOP_NAME = `zz-test-loop-${STAMP}`
const BIZ_SLUG  = `zz-test-biz-${STAMP}`

async function redeem(page: Page, ticketUrl: string): Promise<void> {
  await page.goto(ticketUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForURL(u => !u.pathname.startsWith('/sign-in'), { timeout: 45_000 }).catch(() => {})
}

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return url && key ? createClient(url, key) : null
}

test.setTimeout(180_000)

test('Loop + Business: create → verify → delete (cleanup guaranteed)', async ({ page }) => {
  const auth = requireAuth()
  await redeem(page, auth.ticketUrl)

  let loopId: string | null = null
  let bizCreated = false
  try {
    // ── Loop: create + verify ──────────────────────────────────────────────
    const loopRes = await page.request.post('/api/loops', {
      data: { name: LOOP_NAME, delegated_agent_slug: 'loop-runner', north_star_md: 'test loop — delete me', iteration_cap: 1, mode: 'iterate' },
      timeout: 60_000,
    })
    const loopBody = await loopRes.json() as { ok?: boolean; id?: string; error?: string }
    console.log(`[loop] create → HTTP ${loopRes.status()} ${JSON.stringify(loopBody).slice(0, 200)}`)
    expect(loopBody.ok, `loop create failed: ${loopBody.error}`).toBeTruthy()
    loopId = loopBody.id ?? null
    expect(loopId, 'loop id returned').toBeTruthy()
    const loopList = await page.request.get('/api/loops').then(r => r.json())
    expect(JSON.stringify(loopList), 'new loop appears in list').toContain(LOOP_NAME)
    console.log('[loop] verified in list ✓')

    // ── Business: create row (NO infra) + verify ───────────────────────────
    const bizRes = await page.request.post('/api/businesses/wizard/create', {
      data: { slug: BIZ_SLUG, name: 'ZZ Test Biz (delete me)', niche: 'test', money_model: 'subscription' },
      timeout: 60_000,
    })
    const bizBody = await bizRes.json() as { ok?: boolean; error?: string }
    console.log(`[biz] create → HTTP ${bizRes.status()} ${JSON.stringify(bizBody).slice(0, 200)}`)
    expect(bizBody.ok, `business create failed: ${bizBody.error}`).toBeTruthy()
    bizCreated = true
    const bizList = await page.request.get('/api/businesses').then(r => r.json())
    expect(JSON.stringify(bizList), 'new business appears in list').toContain(BIZ_SLUG)
    const overview = await page.goto(`/businesses/${BIZ_SLUG}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    expect(overview?.status() ?? 0, 'business overview page renders').toBeLessThan(400)
    console.log('[biz] verified in list + overview page renders ✓')
  } finally {
    // ── Cleanup (service-role; no DELETE API for either) ───────────────────
    const db = adminDb()
    if (!db) {
      console.log(`[cleanup] ⚠️ no service-role key — MANUAL delete needed: loops.id=${loopId}, business_operators.slug=${BIZ_SLUG}`)
    } else {
      if (loopId) {
        await db.from('loop_iterations').delete().eq('loop_id', loopId)   // supabase builder is thenable, not a Promise — no .catch()
        const { error } = await db.from('loops').delete().eq('id', loopId)
        console.log(`[cleanup] loop ${loopId} → ${error ? 'ERR ' + error.message : 'deleted ✓'}`)
      }
      if (bizCreated) {
        const { error } = await db.from('business_operators').delete().eq('slug', BIZ_SLUG)
        console.log(`[cleanup] business ${BIZ_SLUG} → ${error ? 'ERR ' + error.message : 'deleted ✓'}`)
      }
    }
  }
})
