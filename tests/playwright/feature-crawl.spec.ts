/**
 * Comprehensive NON-DESTRUCTIVE feature crawl.
 *
 * Visits every operator-facing route with the operator's own session, capturing
 * per route: final HTTP status, console errors, uncaught pageerrors, and failed
 * (>=400) network requests. Read-only — it navigates + observes, it does NOT
 * click create/delete/send/connect buttons (those are gated, run separately).
 *
 * One test, one ticket redemption (Clerk tickets are single-use). Prints a
 * structured summary at the end; never hard-fails on a single bad route so the
 * full crawl always completes.
 *
 * Run: BOT_SESSION_TICKET_URL=<ticket> BASE_URL=http://localhost:3000 \
 *        npx playwright test --project=chromium tests/playwright/feature-crawl.spec.ts
 *
 * Requires BOT_SESSION_TICKET_URL. Skipped otherwise.
 */
import { test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { requireAuth } from './_helpers'

// A live business slug for the dynamic routes. Override via CRAWL_BIZ_SLUG.
const BIZ = process.env.CRAWL_BIZ_SLUG || 'kaizencraft'

// CRAWL_ROUTES (comma-separated) overrides the full list — used to re-run a
// focused subset (e.g. just the flagged routes) fast against a warm server.
const ROUTES: string[] = process.env.CRAWL_ROUTES
  ? process.env.CRAWL_ROUTES.split(',').map(s => s.trim()).filter(Boolean)
  : [
  '/dashboard', '/dashboard/experiments', '/dashboard/org',
  '/manage-platform',
  '/businesses', '/businesses/new',
  `/businesses/${BIZ}`, `/businesses/${BIZ}/chat`, `/businesses/${BIZ}/issues`, `/businesses/${BIZ}/org-chart`,
  '/board', '/approvals', '/audit', '/inbox', '/issues',
  '/agents', '/teams', '/teams/org-chart', '/org',
  '/tools', '/tools/agents', '/tools/agents/managed', '/tools/claw', '/tools/claw/status', '/tools/claw/skills',
  '/tools/memory', '/tools/knowledge', '/tools/content', '/tools/n8n', '/tools/code', '/tools/consultant', '/tools/library',
  '/graph', '/health', '/cron-health', '/signals', '/accomplishments',
  '/learn', '/learn/stats', '/automation-library', '/idea-library', '/idea', '/forge', '/build', '/swarm',
  '/memory/pending-edges', '/simulate/benchmarks',
  '/settings', '/settings?tab=ai', '/settings?tab=skills', '/settings?tab=alerts', '/settings?tab=access',
  '/settings/accounts', '/settings/businesses', '/settings/agents', '/settings/loops',
]

interface RouteResult {
  route: string
  status: number | null
  consoleErrors: string[]
  pageErrors: string[]
  failed: string[]   // "GET /api/x → 500"
}

const BENIGN = /ResizeObserver|Hydration|favicon|third-party cookie|clerk\.com.*telemetry|Download the React DevTools|web-vitals/i

async function redeem(page: Page, ticketUrl: string): Promise<void> {
  await page.goto(ticketUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForURL(u => !u.pathname.startsWith('/sign-in'), { timeout: 45_000 }).catch(() => {})
}

test.setTimeout(15 * 60_000)

test('crawl all operator routes; report console/page/network errors', async ({ page }) => {
  const auth = requireAuth()
  await redeem(page, auth.ticketUrl)

  const results: RouteResult[] = []
  for (const route of ROUTES) {
    const r: RouteResult = { route, status: null, consoleErrors: [], pageErrors: [], failed: [] }
    const onConsole = (m: { type(): string; text(): string }) => { if (m.type() === 'error' && !BENIGN.test(m.text())) r.consoleErrors.push(m.text().slice(0, 300)) }
    const onPageErr = (e: Error) => { if (!BENIGN.test(e.message)) r.pageErrors.push(e.message.slice(0, 300)) }
    const onResp = (resp: { status(): number; url(): string; request(): { method(): string } }) => {
      const s = resp.status()
      if (s >= 400 && !resp.url().includes('/_next/') && !resp.url().includes('favicon')) {
        r.failed.push(`${resp.request().method()} ${resp.url().replace(/https?:\/\/[^/]+/, '')} → ${s}`)
      }
    }
    page.on('console', onConsole as never)
    page.on('pageerror', onPageErr)
    page.on('response', onResp as never)
    try {
      const resp = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      r.status = resp?.status() ?? null
      // Give client components a moment to fetch + render (surfaces runtime errors).
      await page.waitForTimeout(2500)
    } catch (err) {
      r.pageErrors.push(`NAV: ${(err as Error).message.slice(0, 200)}`)
    } finally {
      page.off('console', onConsole as never)
      page.off('pageerror', onPageErr)
      page.off('response', onResp as never)
    }
    results.push(r)
    const bad = r.status && r.status >= 400 ? `HTTP ${r.status}` : ''
    const flag = (r.pageErrors.length || r.failed.length || bad) ? '⚠️ ' : '✓ '
    console.log(`${flag}${route}  [${r.status}]  pageErr=${r.pageErrors.length} consoleErr=${r.consoleErrors.length} netFail=${r.failed.length}`)
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n========== CRAWL SUMMARY ==========')
  const problems = results.filter(r => r.pageErrors.length || r.failed.length || (r.status && r.status >= 400))
  console.log(`Routes crawled: ${results.length} | clean: ${results.length - problems.length} | with issues: ${problems.length}\n`)
  for (const r of problems) {
    console.log(`--- ${r.route}  (HTTP ${r.status}) ---`)
    for (const e of r.pageErrors) console.log(`   pageerror: ${e}`)
    for (const f of r.failed) console.log(`   netfail:   ${f}`)
    for (const c of r.consoleErrors.slice(0, 3)) console.log(`   console:   ${c}`)
  }
  console.log('===================================')

  // Write a reliable report file (the line-reporter's cursor-overwrites make
  // captured stdout lossy). Read this instead of scraping the run log.
  const reportPath = process.env.CRAWL_REPORT_FILE || '/tmp/crawl-report.json'
  try {
    writeFileSync(reportPath, JSON.stringify({ crawled: results.length, problems, results }, null, 2))
    console.log(`[crawl] report → ${reportPath}`)
  } catch { /* best-effort */ }
  // Intentionally does not fail the suite — this is a diagnostic crawl, not a gate.
})
