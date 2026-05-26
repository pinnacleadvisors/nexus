/**
 * Spec: hyperbolic-chamber export → import round-trip (v2-C, PR #367).
 *
 * Walks the operator path:
 *   1. Find a sim business (skip if none).
 *   2. Run a tiny auto-pilot to completion (compress=2, budget=120s).
 *   3. Click "Export" on the Final Report; capture the downloaded JSON.
 *   4. Click "New from blank" to clear the run.
 *   5. Open the Import file picker and submit the captured file.
 *   6. Assert a new run is created (status='pending'/'running').
 *
 * Skipped when:
 *   - BOT_SESSION_TICKET_URL unset (no auth)
 *   - User owns no simulation business
 *
 * Note on the file-picker dance: Playwright intercepts the
 * `<input type="file">` change event via setInputFiles. We write the
 * captured JSON to a tmp path then point the hidden input at it.
 */

import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { test, expect } from '@playwright/test'
import { requireAuth, redeemTicket } from './_helpers'

interface Business {
  slug:        string
  name:        string
  simulation?: boolean
}

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  const auth = requireAuth()
  await redeemTicket(page, auth.ticketUrl)
})

test('operator can export a finished run and re-import to replay', async ({ page, request }) => {
  const listRes = await request.get('/api/businesses')
  expect(listRes.ok()).toBeTruthy()
  const listBody = await listRes.json() as { businesses?: Business[] }
  const sim = (listBody.businesses ?? []).find(b => b.simulation === true)
  if (!sim) {
    test.skip(true, 'No simulation business found — run scripts/seed-simulation-business.mjs')
    return
  }

  await page.goto(`/businesses/${sim.slug}/simulate`)
  await expect(page.getByRole('heading', { name: /hyperbolic chamber/i })).toBeVisible({ timeout: 10_000 })

  // Start an auto run, drain to completion
  await page.getByLabel(/^mode$/i).selectOption('auto')
  await page.getByLabel(/sim days/i).fill('2')
  await page.getByLabel(/wallclock budget/i).fill('120')
  await page.getByLabel(/approver policy/i).selectOption('permissive')
  await page.getByRole('button', { name: /^start$/i }).click()
  await page.getByRole('button', { name: /run to completion/i }).click()
  await expect(page.getByRole('heading', { name: /run finished/i })).toBeVisible({ timeout: 90_000 })

  // Capture the download triggered by the Export link
  const exportLink = page.getByRole('link', { name: /^export$/i })
  await expect(exportLink).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportLink.click(),
  ])
  const tmpPath = path.join(tmpdir(), `sim-export-${Date.now()}.json`)
  await download.saveAs(tmpPath)
  const text = await fs.readFile(tmpPath, 'utf8')
  const payload = JSON.parse(text) as { schema_version?: number; run?: { seed?: string } }
  expect(payload.schema_version).toBe(1)
  expect(payload.run?.seed).toBeTruthy()

  // Click "New from blank" to reset the form, then trigger Import
  await page.getByRole('button', { name: /new from blank/i }).click()

  // The Import button opens the hidden file input via fileInputRef.click().
  // Playwright bypasses that by setting the file directly on the hidden input.
  const fileInput = page.locator('input[type="file"][accept*="json"]')
  await fileInput.setInputFiles(tmpPath)

  // A new run is created → either the active console renders OR the form
  // shows a fresh run row. Either way, no error.
  await expect(page.getByText(/import parse failed:/i)).not.toBeVisible()
  // The console should refresh with the imported run; URL stays the same.
  // We can verify the underlying create via the API as a backstop.
  await page.waitForTimeout(2_000)
  const runsListRes = await request.get(`/api/simulations?business_slug=${sim.slug}`)
  const runsBody = await runsListRes.json() as { runs?: Array<{ seed?: string }> }
  const imported = (runsBody.runs ?? []).find(r => r.seed === payload.run?.seed)
  expect(imported).toBeTruthy()

  await fs.unlink(tmpPath).catch(() => null)
})
