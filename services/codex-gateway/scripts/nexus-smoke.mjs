#!/usr/bin/env node
/**
 * nexus-smoke — lightweight Playwright wrapper for codex-operator agents.
 *
 * Baked into the codex-gateway image at /usr/local/bin/nexus-smoke (Phase 7
 * of task_plan-chat.md). Lets the codex agent run a basic browser smoke
 * test against a deployed preview URL without writing a Playwright script
 * from scratch. The platform-copilot delegates "smoke-test this URL" via
 * the codex-delegate MCP tool; codex then shells out to this script.
 *
 * Usage:
 *   nexus-smoke <url> [--check=<substring>] [--screenshot=<path>] [--timeout-ms=<n>]
 *
 * Examples:
 *   nexus-smoke https://my-preview.vercel.app --check="Sign in" --timeout-ms=15000
 *   nexus-smoke https://my-preview.vercel.app/api/health --check='"ok":true'
 *
 * Output (JSON to stdout, exit 0 on success, non-zero on smoke-test failure):
 *   {
 *     "url":            "https://...",
 *     "status":         200,
 *     "title":          "Nexus",
 *     "loadedMs":       412,
 *     "consoleErrors":  [...],   // any console.error / pageerror events
 *     "checkPresent":   true,    // only when --check is passed
 *     "screenshot":     "/tmp/x.png",  // only when --screenshot is passed
 *     "ok":             true
 *   }
 *
 * Failure modes are JSON too — { ok: false, error: "...", phase: "..." } —
 * so the codex agent can parse the response and surface a clean error
 * card in the platform-copilot chat.
 *
 * Heads-up: this runs headless Chromium against a public URL. Always
 * include a `--timeout-ms` cap (default 30s) to avoid hung jobs eating
 * codex gateway request budget.
 */
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const url = args.find(a => !a.startsWith('--'))
if (!url) {
  console.log(JSON.stringify({ ok: false, error: 'Usage: nexus-smoke <url> [--check=<text>] [--screenshot=<path>] [--timeout-ms=<n>]' }))
  process.exit(2)
}

function flag(name, fallback) {
  const hit = args.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const check        = flag('check',        null)
const screenshot   = flag('screenshot',   null)
const timeoutMs    = Number(flag('timeout-ms', '30000'))

const consoleErrors = []
const result = {
  url,
  status:        null,
  title:         null,
  loadedMs:      null,
  consoleErrors,
  ok:            false,
}

let browser
try {
  browser = await chromium.launch({ headless: true, timeout: 10_000 })
  const ctx = await browser.newContext({
    viewport:    { width: 1280, height: 800 },
    userAgent:   'NexusSmoke/0.1 (+nexus-smoke; codex-gateway)',
  })
  const page = await ctx.newPage()
  page.on('console',   m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', e => { consoleErrors.push(String(e?.message ?? e)) })

  const t0 = Date.now()
  const resp = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs })
  result.loadedMs = Date.now() - t0
  result.status   = resp?.status() ?? null

  // The title fetch can hang on some SPAs — bound it.
  result.title = await Promise.race([
    page.title().catch(() => null),
    new Promise(r => setTimeout(() => r(null), 2_000)),
  ])

  if (check) {
    const body = await page.content().catch(() => '')
    result.checkPresent = body.includes(check)
  }

  if (screenshot) {
    await page.screenshot({ path: screenshot, fullPage: false })
    result.screenshot = screenshot
  }

  const okStatus = result.status !== null && result.status >= 200 && result.status < 400
  const okCheck  = check ? result.checkPresent === true : true
  result.ok = okStatus && okCheck
  if (!okStatus) result.error = `non-2xx/3xx status ${result.status}`
  else if (check && !result.checkPresent) result.error = `--check substring not found on the rendered page`

  console.log(JSON.stringify(result))
  process.exit(result.ok ? 0 : 1)
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  console.log(JSON.stringify({ ok: false, url, error: msg, phase: 'launch_or_navigate' }))
  process.exit(2)
} finally {
  try { await browser?.close() } catch { /* swallow */ }
}
