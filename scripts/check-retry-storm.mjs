#!/usr/bin/env node
/**
 * Static-pattern audit for retry-storm vulnerabilities.
 *
 * Runs a fixed set of grep-based checks against the repo to catch the patterns
 * that caused the 2026-05-03 incident ($100 Vercel + 14.49 GB Supabase egress).
 * Each check has a single corresponding row in docs/RETRY_STORM_AUDIT.md.
 *
 * Run via:
 *   npm run check:retry-storm
 *   node scripts/check-retry-storm.mjs
 *   node scripts/check-retry-storm.mjs --strict   (exit 1 on warnings too)
 *
 * Designed to be cheap (~1s on a cold cache), idempotent, and side-effect-free.
 * Wire into a pre-commit hook or CI step alongside `npx tsc --noEmit`.
 *
 * Each check returns: { passed, findings: [{file, line, snippet, hint}] }.
 * The script aggregates and prints a summary; exits 1 on any FAIL, 0 otherwise.
 *
 * NOT a substitute for unit tests of the helpers themselves (those need Vitest).
 * This is the lightweight signal that catches "developer forgot to use the
 * helper" the moment it happens, before the bug ships and burns paid services.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative } from 'path'

const ROOT = join(import.meta.dirname, '..')
const STRICT = process.argv.includes('--strict')

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Recursively list .ts/.tsx files under a directory, skipping node_modules + .next. */
function listFiles(dir, filter = /\.(ts|tsx)$/) {
  if (!existsSync(dir)) return []
  const out = []
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try { entries = readdirSync(cur) } catch { continue }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.next' || name === '.git' || name === 'dist') continue
      const full = join(cur, name)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) stack.push(full)
      else if (filter.test(name)) out.push(full)
    }
  }
  return out
}

/** Find lines matching `re` in the file. Returns [{line, text}, ...]. */
function grepFile(path, re) {
  let text
  try { text = readFileSync(path, 'utf8') } catch { return [] }
  const lines = text.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) out.push({ line: i + 1, text: lines[i].trim() })
  }
  return out
}

function rel(p) { return relative(ROOT, p) }

/**
 * Per-line exemption marker. Devs can add `// retry-storm-check: ignore` on
 * the offending line or any of the 5 lines above it (so a multi-line
 * justification block can precede the chained .insert(...).select(...)
 * pattern). Use SPARINGLY — the comment should be paired with a one-line
 * reason explaining why this site is safe.
 */
function isLineExempt(allLines, lineIndex) {
  for (let j = lineIndex; j >= Math.max(0, lineIndex - 5); j--) {
    if (/retry-storm-check:\s*ignore/.test(allLines[j] ?? '')) return true
  }
  return false
}

// ── Checks ────────────────────────────────────────────────────────────────────

/**
 * 1. Frontend pollers must use usePollWithBackoff.
 *    Catches `setInterval(...)` in (protected)/ pages without the hook import.
 */
function checkFrontendPollers() {
  const findings = []
  const files = listFiles(join(ROOT, 'app', '(protected)'))
  for (const f of files) {
    const intervals = grepFile(f, /setInterval\s*\(/)
    if (intervals.length === 0) continue
    const text = readFileSync(f, 'utf8')
    if (text.includes('usePollWithBackoff')) continue
    for (const hit of intervals) {
      findings.push({
        file:    rel(f),
        line:    hit.line,
        snippet: hit.text.slice(0, 100),
        hint:    'Replace setInterval with usePollWithBackoff (lib/hooks/usePollWithBackoff.ts) — catches 5xx → exp backoff → auto-pause.',
      })
    }
  }
  return { name: 'frontend-pollers-use-backoff', findings }
}

/**
 * 2. Webhook routes must call claimEvent before side effects.
 *    Catches webhook handlers that lack idempotency (audit Tier 1).
 */
function checkWebhookIdempotency() {
  const findings = []
  const dir = join(ROOT, 'app', 'api', 'webhooks')
  if (!existsSync(dir)) return { name: 'webhook-idempotency', findings }
  const handlers = listFiles(dir).filter(f => f.endsWith('route.ts'))
  // Slack route is read-only slash commands — exempt.
  const EXEMPT = ['slack/route.ts']
  for (const f of handlers) {
    if (EXEMPT.some(e => f.endsWith(e))) continue
    const text = readFileSync(f, 'utf8')
    if (!text.includes('claimEvent')) {
      findings.push({
        file:    rel(f),
        line:    1,
        snippet: '(missing import)',
        hint:    "Import { claimEvent } from '@/lib/webhooks/idempotency' and call it before any DB writes / external calls.",
      })
    }
  }
  return { name: 'webhook-idempotency', findings }
}

/**
 * 3. Outbound fetches in lib/ should declare a timeout.
 *    Catches `await fetch(...)` without `signal:` or `AbortSignal.timeout` nearby.
 */
function checkFetchTimeouts() {
  const findings = []
  // Skip known-OK files: r2.ts uses AWS SDK (its own timeouts), supabase.ts
  // uses the supabase client, claw/health.ts has its own timeout pattern.
  const SKIP = ['lib/r2.ts', 'lib/supabase.ts', 'lib/claw/health.ts']
  const files = listFiles(join(ROOT, 'lib')).filter(f => {
    const r = rel(f)
    return !SKIP.some(s => r === s) && !r.startsWith('lib/database.types')
  })
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!/await\s+fetch\s*\(/.test(lines[i])) continue
      if (isLineExempt(lines, i)) continue
      // Look in the next 30 lines for `signal:` / AbortSignal. A brace-counting
      // approach was tried first but choked on template-literal `${VAR}`
      // patterns (the URL line in many fetch calls). 30 lines is enough to
      // span every fetch options object in this repo without crossing into
      // the next sibling fetch.
      const window = lines.slice(i, Math.min(i + 30, lines.length)).join('\n')
      if (/signal\s*:|AbortSignal/.test(window)) continue
      findings.push({
        file:    rel(f),
        line:    i + 1,
        snippet: lines[i].trim().slice(0, 100),
        hint:    'Add `signal: AbortSignal.timeout(15_000)` to the fetch options. Hung fetches block function-seconds and amplify under retry.',
      })
    }
  }
  return { name: 'fetch-timeouts', findings }
}

/**
 * 4. Inngest functions must declare an explicit `retries:` config.
 *    Default is 3 → cost amplifier on every paid call.
 */
function checkInngestRetries() {
  const findings = []
  const dir = join(ROOT, 'inngest', 'functions')
  if (!existsSync(dir)) return { name: 'inngest-retries-explicit', findings }
  const files = listFiles(dir)
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    if (!text.includes('createFunction')) continue
    // Crude: check that `retries:` appears in the file at all. Doesn't enforce
    // location relative to createFunction, but catches the "I forgot" case.
    if (!/retries\s*:/.test(text)) {
      findings.push({
        file:    rel(f),
        line:    grepFile(f, /createFunction/)[0]?.line ?? 1,
        snippet: 'inngest.createFunction({ ... })',
        hint:    'Add explicit `retries: 0` (no auto-retry) or `retries: 1` (one retry). Default 3 multiplies paid-call cost on flaky upstreams.',
      })
    }
  }
  return { name: 'inngest-retries-explicit', findings }
}

/**
 * 5. Task inserts should go through insertTask helper.
 *    Anchors on `.insert(` and looks BACKWARD up to 4 lines for `.from('tasks')`,
 *    so multi-line chains (`.from('tasks')\n.insert(...)`) are matched but
 *    `.from('tasks').select(...)` is not.
 *
 *    Skipped contexts (auto-retry-safe — these are user-initiated button
 *    clicks, not webhook callbacks):
 *      - lib/board/insert-task.ts (the helper itself)
 *      - app/api/board/route.ts   (CRUD endpoint)
 *      - app/api/agent/route.ts   (one-shot user click; no upstream retry)
 */
function checkTaskInserts() {
  const findings = []
  const SKIP_FILES = [
    'lib/board/insert-task.ts',
    'app/api/board/route.ts',
    'app/api/agent/route.ts',
  ]
  const files = [
    ...listFiles(join(ROOT, 'app')),
    ...listFiles(join(ROOT, 'inngest')),
  ]
  for (const f of files) {
    const r = rel(f)
    if (SKIP_FILES.some(s => r === s)) continue
    const text = readFileSync(f, 'utf8')
    if (text.includes('insertTask')) continue   // Already using helper
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      // Anchor on `.insert(` — the actionable line.
      if (!/\.insert\s*\(/.test(lines[i])) continue
      if (isLineExempt(lines, i)) continue
      // Look back up to 4 lines for `.from('tasks')`. Stops on blank line so
      // we don't cross unrelated chains.
      let foundFromTasks = false
      for (let j = i; j >= Math.max(0, i - 4); j--) {
        if (lines[j].trim() === '') break
        if (/\.from\(['"`]tasks['"`]\)/.test(lines[j])) { foundFromTasks = true; break }
      }
      if (!foundFromTasks) continue
      findings.push({
        file:    rel(f),
        line:    i + 1,
        snippet: lines[i].trim().slice(0, 100),
        hint:    "Use insertTask(db, row) from '@/lib/board/insert-task'. Falls back to lineage-free insert if migration 025 isn't applied.",
      })
    }
  }
  return { name: 'task-inserts-use-helper', findings }
}

/**
 * 6. No naive retry loops in lib/ or inngest/.
 *    Catches `for (let i = 0; i < N; i++) { try { ... } catch { } }` patterns.
 */
function checkNaiveRetryLoops() {
  const findings = []
  const files = [
    ...listFiles(join(ROOT, 'lib')),
    ...listFiles(join(ROOT, 'inngest')),
  ]
  // Skip the helper that LEGITIMATELY has a retry loop.
  const SKIP = ['lib/http/fetch-with-timeout.ts', 'scripts/migrate.mjs']
  for (const f of files) {
    if (SKIP.some(s => rel(f) === s)) continue
    const text = readFileSync(f, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      // Common naive retry patterns
      if (!/for\s*\(\s*let\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*(\w+|\d+)\s*;.*\)\s*{?/.test(lines[i])) continue
      // Look 1-10 lines below for try/catch + await
      const window = lines.slice(i, Math.min(i + 12, lines.length)).join('\n')
      if (!/try\s*{[\s\S]*?await/.test(window)) continue
      if (!/catch/.test(window)) continue
      findings.push({
        file:    rel(f),
        line:    i + 1,
        snippet: lines[i].trim().slice(0, 100),
        hint:    'Naive retry loop. Use lib/http/fetch-with-timeout.ts (bounded retry+backoff) or lib/health/circuit-breaker.ts.',
      })
    }
  }
  return { name: 'no-naive-retry-loops', findings }
}

// ── Runner ────────────────────────────────────────────────────────────────────

const CHECKS = [
  checkFrontendPollers,
  checkWebhookIdempotency,
  checkFetchTimeouts,
  checkInngestRetries,
  checkTaskInserts,
  checkNaiveRetryLoops,
]

function color(code, s) { return process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s }
const red    = s => color('31', s)
const green  = s => color('32', s)
const yellow = s => color('33', s)
const dim    = s => color('2',  s)

console.log(`\n🔍  Retry-storm static check\n    Repo: ${ROOT}\n`)

let totalFindings = 0
for (const check of CHECKS) {
  const result = check()
  const passed = result.findings.length === 0
  const label  = passed ? green('PASS') : red('FAIL')
  console.log(`  ${label}  ${result.name}  ${dim(`(${result.findings.length} finding${result.findings.length === 1 ? '' : 's'})`)}`)
  for (const f of result.findings.slice(0, 10)) {
    console.log(`         ${yellow(f.file + ':' + f.line)}  ${f.snippet}`)
    console.log(`             ${dim('→ ' + f.hint)}`)
  }
  if (result.findings.length > 10) {
    console.log(`         ${dim(`(+${result.findings.length - 10} more — open the file to see all)`)}`)
  }
  totalFindings += result.findings.length
}

console.log()
if (totalFindings === 0) {
  console.log(green('✅  All retry-storm checks passed.\n'))
  process.exit(0)
} else {
  console.log(red(`❌  ${totalFindings} retry-storm finding${totalFindings === 1 ? '' : 's'} across ${CHECKS.filter(c => c().findings.length > 0).length} check${CHECKS.filter(c => c().findings.length > 0).length === 1 ? '' : 's'}.`))
  console.log(dim('   See docs/RETRY_STORM_AUDIT.md for the rationale + fix patterns.\n'))
  process.exit(STRICT ? 1 : 1)
}
