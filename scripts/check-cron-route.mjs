#!/usr/bin/env node
/**
 * Static-pattern audit for cron-route safety.
 *
 * Born from the 2026-05-25 post-deploy-smoke incident: the route returned
 * 502 on qa-runner unreachability, cron-job.org auto-disabled it after
 * ~26 consecutive 5xx. AGENTS.md retry-storm rule already requires
 * 200 + {ok:false} on transient failures; this script catches violations
 * the moment they ship.
 *
 * What we check (per route under app/api/cron/**\/route.ts):
 *   1. ANY `NextResponse.json(..., { status: 5xx })` (or { status: 500..599 })
 *      — cron-job.org treats 5xx as failure and auto-disables after ~26.
 *      Exception: 503 is allowed when explicitly marked as the "cost cap
 *      exceeded" case. Use `// cron-check: ignore` to allowlist a line.
 *   2. CRON_SECRET-based auth present somewhere in the route body —
 *      ?secret= query OR Authorization header check. Otherwise the
 *      route is open to the public internet.
 *
 * Allow-by-comment: any line ending with `// cron-check: ignore` is
 * exempt + the next line is also skipped.
 *
 * Run:   npm run check:cron-route
 * Or:    node scripts/check-cron-route.mjs
 * Strict mode: --strict  (exits 1 on warnings too; default is fail-only-on-error)
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative } from 'path'

const ROOT = join(import.meta.dirname, '..')
const CRON_DIR = join(ROOT, 'app', 'api', 'cron')

const args = process.argv.slice(2)
const STRICT = args.includes('--strict')

function listRouteFiles(dir) {
  if (!existsSync(dir)) return []
  const out = []
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try { entries = readdirSync(cur) } catch { continue }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.next' || name === 'dist') continue
      const full = join(cur, name)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) stack.push(full)
      else if (name === 'route.ts') out.push(full)
    }
  }
  return out
}

/** Lines matching the 5xx-status pattern, skipping ones with the ignore comment. */
function find5xx(path) {
  let text
  try { text = readFileSync(path, 'utf8') } catch { return [] }
  const lines = text.split('\n')
  const out = []
  // Pattern: `status: 5xx` (handles `, { status: 500 })`, `status: 502`, etc).
  // Won't match `r.status === 502` (no `:` followed by number).
  const re = /status\s*:\s*(5\d\d)\b/
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = line.match(re)
    if (!m) continue
    // Allow per-line ignore comments (and the line right after, since
    // some renderers put the comment ABOVE the statement).
    if (line.includes('cron-check: ignore')) continue
    if (i > 0 && lines[i - 1].includes('cron-check: ignore')) continue
    out.push({ line: i + 1, text: line.trim(), status: m[1] })
  }
  return out
}

/** True when the file has SOME form of CRON_SECRET-based auth. */
function hasCronSecretAuth(path) {
  let text
  try { text = readFileSync(path, 'utf8') } catch { return false }
  // Either ?secret= query param OR Authorization header check OR allowlist comment.
  if (text.includes('CRON_SECRET')) return true
  if (text.includes('cron-check: auth-ok')) return true  // explicit override (e.g. route only callable internally)
  return false
}

/** v12 — parse sync-crons-hmem.mjs SPECS to learn which `/api/cron/<name>`
 *  paths are actually registered with cron-job.org. Only those need the
 *  strict 5xx + auth checks (cron-job.org's auto-disable behaviour only
 *  matters for routes it calls). Routes UNDER /api/cron that are NOT
 *  registered are still in scope for the 5xx check (defensive — they
 *  might get registered later) but skip the auth warning. */
function loadRegisteredPaths() {
  try {
    const txt = readFileSync(join(ROOT, 'scripts', 'sync-crons-hmem.mjs'), 'utf8')
    const out = new Set()
    // Match `path: '/api/cron/<name>...'` in SPECS entries.
    for (const m of txt.matchAll(/path:\s*'([^']+)'/g)) {
      // Strip query string; we only key on the route path.
      const path = m[1].split('?')[0]
      out.add(path)
    }
    // Also include `vercel.json` cron entries when present (we hit the
    // same routes from both schedulers historically).
    try {
      const vj = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'))
      for (const c of vj.crons ?? []) if (c.path) out.add(c.path)
    } catch { /* no vercel.json, fine */ }
    return out
  } catch {
    // Sync script missing — fall back to "treat every route as registered"
    // so the check stays strict by default.
    return null
  }
}

function main() {
  const files = listRouteFiles(CRON_DIR)
  if (files.length === 0) {
    console.log('No cron routes found under app/api/cron/.')
    process.exit(0)
  }

  console.log(`🔍  Cron-route static check`)
  console.log(`    Repo: ${ROOT}`)
  const registered = loadRegisteredPaths()
  if (registered) {
    console.log(`    Registered with cron-job.org: ${registered.size} route(s)`)
  } else {
    console.log(`    (sync-crons-hmem.mjs not found — treating every route as registered)`)
  }
  console.log('')

  let errors = 0
  let warnings = 0
  const failures = []

  for (const file of files) {
    const rel = relative(ROOT, file)
    // Derive `/api/cron/<name>` from the file path.
    const routePath = '/' + rel.replace(/^app\//, '').replace(/\/route\.ts$/, '')
    const isRegistered = registered ? registered.has(routePath) : true

    const findings = find5xx(file)
    const hasAuth  = hasCronSecretAuth(file)

    // 5xx check applies to every cron route (forward compatibility — any
    // could be registered tomorrow). Auth warning applies only when the
    // route IS registered; non-registered routes use Clerk/other auth.
    const fileErrors = findings.length
    const fileWarns  = (isRegistered && !hasAuth) ? 1 : 0
    errors  += fileErrors
    warnings += fileWarns

    if (fileErrors === 0 && fileWarns === 0) {
      console.log(`  PASS  ${rel}${isRegistered ? '' : '  (not registered with cron-job.org — auth check skipped)'}`)
      continue
    }
    failures.push({ file: rel, findings, hasAuth, isRegistered })
  }

  if (failures.length === 0) {
    console.log('\n✅  All cron-route checks passed.')
    process.exit(0)
  }

  console.log('')
  for (const f of failures) {
    console.log(`  FAIL  ${f.file}`)
    for (const x of f.findings) {
      console.log(`    L${x.line}: status: ${x.status}   ${x.text}`)
      console.log(`           → cron-job.org auto-disables after ~26 consecutive 5xx. Return 200 + {ok:false, error} or add \`// cron-check: ignore\` on the line.`)
    }
    if (f.isRegistered && !f.hasAuth) {
      console.log(`    WARN  no CRON_SECRET check found — cron-job.org calls this route, so anyone can.`)
      console.log(`           Add \`?secret=<CRON_SECRET>\` validation or move to app/api/admin-trigger/ if the route shouldn't be a cron.`)
    }
  }
  console.log('')
  console.log(`${errors} error(s), ${warnings} warning(s).`)
  // Exit 1 on errors always; warnings only fail in --strict mode.
  if (errors > 0 || (STRICT && warnings > 0)) process.exit(1)
  process.exit(0)
}

main()
