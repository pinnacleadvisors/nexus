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

function main() {
  const files = listRouteFiles(CRON_DIR)
  if (files.length === 0) {
    console.log('No cron routes found under app/api/cron/.')
    process.exit(0)
  }

  console.log(`🔍  Cron-route static check`)
  console.log(`    Repo: ${ROOT}\n`)

  let errors = 0
  let warnings = 0
  const failures = []

  for (const file of files) {
    const rel = relative(ROOT, file)
    const findings = find5xx(file)
    const hasAuth  = hasCronSecretAuth(file)

    const fileErrors = findings.length
    const fileWarns  = hasAuth ? 0 : 1
    errors  += fileErrors
    warnings += fileWarns

    if (fileErrors === 0 && fileWarns === 0) {
      console.log(`  PASS  ${rel}`)
      continue
    }
    failures.push({ file: rel, findings, hasAuth })
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
    if (!f.hasAuth) {
      console.log(`    WARN  no CRON_SECRET check found — anyone can hit this cron URL.`)
      console.log(`           Add \`?secret=<CRON_SECRET>\` validation or mark internal-only with \`// cron-check: auth-ok\` somewhere in the file.`)
    }
  }
  console.log('')
  console.log(`${errors} error(s), ${warnings} warning(s).`)
  // Exit 1 on errors always; warnings only fail in --strict mode.
  if (errors > 0 || (STRICT && warnings > 0)) process.exit(1)
  process.exit(0)
}

main()
