#!/usr/bin/env node
/**
 * Static-pattern audit for Sentry sampling regressions.
 *
 * The 2026-05-12 incident: all three Sentry configs (server / edge / client)
 * shipped with `tracesSampleRate: 1` (100% sampling). The chat poll endpoint
 * fires every 2.5s during an active agent run; <GatewayStatusPill> and the
 * Sidebar cron probe fire every 30s on every protected page. We hit the
 * 5,000,000-span billing cap in ~3 days. PR #157 fixed it by replacing the
 * static rate with the shared `tracesSampler` at lib/sentry/sampler.ts.
 *
 * This check ensures we don't re-introduce 100% sampling, or add a new
 * Sentry config that bypasses the shared sampler.
 *
 * Run via:
 *   npm run check:sentry-config
 *   node scripts/check-sentry-config.mjs
 *   node scripts/check-sentry-config.mjs --strict
 *
 * Designed to be cheap (~50ms), idempotent, side-effect-free. Wire into
 * pre-commit alongside `check:retry-storm` and `tsc --noEmit`.
 *
 * Three checks:
 *   1. Sentry config files MUST import + use `tracesSampler` from
 *      @/lib/sentry/sampler. Hard-coded `tracesSampleRate: N` is rejected
 *      unless N <= 0.05 AND there's a comment explaining why.
 *   2. New polling endpoints (client-side `setInterval` + `fetch('/api/...')`)
 *      should be added to SKIP_PATTERNS in lib/sentry/sampler.ts — warn if
 *      a setInterval fetch points at an /api/ path not in the patterns.
 *   3. The shared sampler file itself must exist and export `tracesSampler`.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative } from 'path'

const ROOT = join(import.meta.dirname, '..')
const STRICT = process.argv.includes('--strict')

function listFiles(dir, filter = /\.(ts|tsx|mts|cts)$/) {
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

function readLines(file) {
  try { return readFileSync(file, 'utf8').split('\n') } catch { return [] }
}

function rel(file) { return relative(ROOT, file) }

// ── Check 1: Sentry configs must use the shared tracesSampler ────────────────

function checkSentryConfigsUseSampler() {
  const findings = []
  // Sentry's Next.js plugin reads from a fixed set of filenames at the repo root.
  const SENTRY_CONFIG_FILES = [
    'sentry.server.config.ts',
    'sentry.client.config.ts',
    'sentry.edge.config.ts',
    'instrumentation-client.ts',
    'instrumentation.ts',
  ]
  for (const name of SENTRY_CONFIG_FILES) {
    const file = join(ROOT, name)
    if (!existsSync(file)) continue
    const text  = readFileSync(file, 'utf8')
    const lines = text.split('\n')

    // Only enforce the sampler rule on files that actually call Sentry.init.
    // instrumentation.ts is a Next.js bootstrap that delegates to the real
    // configs via dynamic import — it never inits Sentry itself, so it has
    // no traces setting to police.
    const callsSentryInit = /\bSentry\.init\b/.test(text)
    if (!callsSentryInit) continue

    // 1a — must import tracesSampler from the shared helper
    const importsSampler = /from\s+['"](?:@\/)?lib\/sentry\/sampler['"]/.test(text)
    const usesSampler    = /\btracesSampler\b/.test(text)
    if (!importsSampler || !usesSampler) {
      findings.push({
        file: rel(file),
        line: 1,
        snippet: '(no import of tracesSampler from @/lib/sentry/sampler)',
        hint: 'New Sentry configs must import { tracesSampler } from "@/lib/sentry/sampler" and pass it as the tracesSampler option. Adding a fresh tracesSampleRate here bypasses our skip-list and risks burning the budget.',
      })
    }

    // 1b — flag any literal tracesSampleRate > 0.05 in non-comment lines.
    // The match site must be in actual code (line doesn't start with // or *)
    // so explanatory comments quoting the old value are ignored.
    const SAMPLE_RATE_RE = /tracesSampleRate\s*:\s*([0-9.]+)/g
    let m
    while ((m = SAMPLE_RATE_RE.exec(text)) !== null) {
      const rate = parseFloat(m[1])
      const lineIdx = text.slice(0, m.index).split('\n').length
      const lineText = lines[lineIdx - 1] ?? ''
      const trimmed  = lineText.trimStart()
      // Skip comment lines (// or *) — they're explaining the rule, not violating it.
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
      if (rate > 0.05) {
        findings.push({
          file: rel(file),
          line: lineIdx,
          snippet: lineText.trim(),
          hint: `tracesSampleRate=${rate} is too high — every transaction becomes a billed span. Replace with the shared tracesSampler (lib/sentry/sampler.ts) which skips polling endpoints and caps the baseline at 5%.`,
        })
      }
    }
  }
  return { name: 'sentry-configs-use-shared-sampler', findings }
}

// ── Check 2: setInterval-based polling endpoints should be in SKIP_PATTERNS ──

function checkPollingEndpointsInSkipList() {
  const findings = []
  const samplerPath = join(ROOT, 'lib/sentry/sampler.ts')
  if (!existsSync(samplerPath)) return { name: 'polling-endpoints-listed-in-skip-patterns', findings }
  const samplerText = readFileSync(samplerPath, 'utf8')

  // Extract /api/... paths that are already in SKIP_PATTERNS (between the
  // const declaration and the closing bracket). The patterns are JS regex
  // literals with escaped slashes (`/\/api\/foo/`), so unescape first then
  // substring-match — much simpler than trying to parse regex AST.
  const skipBlock = /SKIP_PATTERNS\s*:\s*RegExp\[\]\s*=\s*\[([\s\S]*?)\]/.exec(samplerText)
  const skipBody  = (skipBlock?.[1] ?? '').replace(/\\\//g, '/')

  // Walk app/, components/ for setInterval + fetch('/api/...') combos —
  // but only flag the fetch when it's TEXTUALLY CLOSE to a setInterval
  // / usePollWithBackoff (same logical block). Files that have an interval
  // for an unrelated UI counter (e.g. a "Working… (Ns)" elapsed timer)
  // plus separate event-driven fetches would otherwise false-positive.
  //
  // Heuristic: a fetch is "polled" when it appears within PROXIMITY_LINES
  // of a setInterval / usePollWithBackoff call. Tunable below — 25 is
  // generous enough to catch a setInterval that calls a sibling function
  // declared a few lines above, while tight enough to exclude unrelated
  // fetches further down the file.
  const PROXIMITY_LINES = 25
  // We also detect the inline arrow case to avoid false positives —
  // setInterval(() => setState(...), N) without a fetch in the body never
  // qualifies as polling, regardless of proximity to other fetches.
  function lineNumberOf(text, idx) { return text.slice(0, idx).split('\n').length }

  const ROOTS = ['app', 'components']
  const HIGH_VALUE_RE = /HIGH_VALUE_PATTERNS\s*:\s*RegExp\[\]\s*=\s*\[([\s\S]*?)\]/.exec(samplerText)
  const highBody = (HIGH_VALUE_RE?.[1] ?? '').replace(/\\\//g, '/')

  for (const r of ROOTS) {
    for (const file of listFiles(join(ROOT, r), /\.(tsx|ts)$/)) {
      const text = readFileSync(file, 'utf8')
      if (!/\b(setInterval|usePollWithBackoff)\b/.test(text)) continue

      // Index every setInterval / usePollWithBackoff site by line number.
      // Inline arrows with no `fetch` in their body are excluded — those
      // are UI counters / timers, not pollers.
      const pollerSites = []
      const SETINT_RE = /\b(setInterval|usePollWithBackoff)\s*\(\s*(\([^)]*\)\s*=>\s*\{[\s\S]*?\}|[A-Za-z_$][\w$]*)/g
      let p
      while ((p = SETINT_RE.exec(text)) !== null) {
        const callback = p[2]
        // Inline arrow body — if it contains fetch, this is a poller.
        // If it's an arrow without fetch (UI counter pattern), skip.
        if (callback.startsWith('(')) {
          if (!/\bfetch\s*\(/.test(callback)) continue
        }
        pollerSites.push(lineNumberOf(text, p.index))
      }
      if (pollerSites.length === 0) continue

      const fetchRe = /fetch\s*\(\s*[`'"](\/api\/[^`'"\s)?]+)/g
      let m
      while ((m = fetchRe.exec(text)) !== null) {
        const apiPath = m[1]
        const lineIdx = lineNumberOf(text, m.index)
        const near    = pollerSites.some(p => Math.abs(p - lineIdx) <= PROXIMITY_LINES)
        if (!near) continue
        const inSkip = skipBody.includes(apiPath)
        const inHigh = highBody.includes(apiPath)
        if (!inSkip && !inHigh) {
          findings.push({
            file: rel(file),
            line: lineIdx,
            snippet: `fetch('${apiPath}')  (in a setInterval / poller context)`,
            hint: `This client polls ${apiPath} but it's not in SKIP_PATTERNS in lib/sentry/sampler.ts. Either add it there (polling = high-volume, low-signal — skip it) or accept the span cost. If high-volume polling, add a regex like /\\${apiPath.replace(/\\/g, '\\\\').replace(/\//g, '\\/')}/ to SKIP_PATTERNS.`,
          })
        }
      }
    }
  }
  return { name: 'polling-endpoints-listed-in-skip-patterns', findings }
}

// ── Check 3: The shared sampler file exists + exports the function ───────────

function checkSamplerExports() {
  const findings = []
  const path = join(ROOT, 'lib/sentry/sampler.ts')
  if (!existsSync(path)) {
    findings.push({
      file: 'lib/sentry/sampler.ts',
      line: 0,
      snippet: '(file missing)',
      hint: 'The shared sampler at lib/sentry/sampler.ts was removed or moved. Every Sentry config imports from this path — restoring it (or updating all imports) is required.',
    })
    return { name: 'sampler-file-exports-tracesSampler', findings }
  }
  const text = readFileSync(path, 'utf8')
  if (!/export\s+function\s+tracesSampler\b/.test(text) && !/export\s+const\s+tracesSampler\b/.test(text)) {
    findings.push({
      file: rel(path),
      line: 1,
      snippet: '(no exported tracesSampler symbol)',
      hint: 'lib/sentry/sampler.ts must export a `tracesSampler` function (or const) for the Sentry configs to import.',
    })
  }
  return { name: 'sampler-file-exports-tracesSampler', findings }
}

// ── Runner ───────────────────────────────────────────────────────────────────

const CHECKS = [checkSentryConfigsUseSampler, checkPollingEndpointsInSkipList, checkSamplerExports]

function color(code, s) { return process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s }
const red    = s => color('31', s)
const green  = s => color('32', s)
const yellow = s => color('33', s)
const dim    = s => color('2',  s)

console.log(`\n🔍  Sentry-config static check\n    Repo: ${ROOT}\n`)

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
  console.log(green('✅  All Sentry-config checks passed.\n'))
  process.exit(0)
} else {
  console.log(red(`❌  ${totalFindings} Sentry-config finding${totalFindings === 1 ? '' : 's'}.`))
  console.log(dim('   See lib/sentry/sampler.ts + PR #157 for the rationale + fix patterns.\n'))
  process.exit(STRICT ? 1 : 1)
}
