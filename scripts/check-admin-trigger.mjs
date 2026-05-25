#!/usr/bin/env node
/**
 * Static check for app/api/admin-trigger/** owner gates.
 *
 * Sister check to scripts/check-cron-route.mjs (v13). Born from the v12
 * rename: routes under app/api/admin-trigger/ are owner-only manual
 * triggers (NOT cron-job.org routes). Forgetting the ALLOWED_USER_IDS
 * gate on one of these would expose a debug/rebuild action to anyone with
 * a Clerk session — including the owner's own accidental Cmd-click.
 *
 * What we enforce per route (app/api/admin-trigger/**\/route.ts):
 *   1. The file mentions `ALLOWED_USER_IDS` — i.e. it gates by the owner
 *      allowlist. Use `// admin-check: ignore` on a single line to allowlist
 *      a route that legitimately runs unauthenticated (none today).
 *
 * Allow-by-comment: any line ending with `// admin-check: ignore` is
 * exempt + the next line is also skipped.
 *
 * Run:   npm run check:admin-trigger
 * Or:    node scripts/check-admin-trigger.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative } from 'path'

const ROOT = join(import.meta.dirname, '..')
const ADMIN_DIR = join(ROOT, 'app', 'api', 'admin-trigger')

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

function hasOwnerGate(path) {
  let text
  try { text = readFileSync(path, 'utf8') } catch { return false }
  // The pattern across all admin-trigger routes is:
  //   process.env.ALLOWED_USER_IDS  +  an isOwner() check.
  // Either signal is enough; the absence of BOTH is what flags as bad.
  // (Allowlist via `// admin-check: ignore` is rare — only valid case is
  // a route invoked by a trusted internal service, e.g. Inngest webhook.)
  if (text.includes('admin-check: ignore')) return true
  return text.includes('ALLOWED_USER_IDS')
}

function main() {
  const files = listRouteFiles(ADMIN_DIR)
  if (files.length === 0) {
    console.log('No admin-trigger routes found under app/api/admin-trigger/.')
    process.exit(0)
  }

  console.log(`🔍  Admin-trigger static check`)
  console.log(`    Repo: ${ROOT}`)
  console.log('')

  let errors = 0
  const failures = []
  for (const file of files) {
    const rel = relative(ROOT, file)
    if (hasOwnerGate(file)) {
      console.log(`  PASS  ${rel}`)
      continue
    }
    errors += 1
    failures.push(rel)
    console.log(`  FAIL  ${rel}`)
    console.log(`         no ALLOWED_USER_IDS gate found — route would be reachable by any Clerk session.`)
    console.log(`         Add an isOwner() check OR \`// admin-check: ignore\` with a one-line justification.`)
  }

  if (errors === 0) {
    console.log('\n✅  All admin-trigger checks passed.')
    process.exit(0)
  }
  console.log(`\n${errors} error(s).`)
  process.exit(1)
}

main()
