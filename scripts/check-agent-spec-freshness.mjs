#!/usr/bin/env node
/**
 * Static check: every `.claude/agents/*.md` has a recent
 * `topology_last_verified: YYYY-MM-DD` frontmatter field.
 *
 * Recommendation D from the agent-process audit. Forces a quarterly
 * re-read of every agent spec so KVM2-style stale infra references
 * don't quietly accumulate. When an operator opens a spec and runs
 * through it, they bump the date — the act of stamping IS the audit.
 *
 * Threshold: 90 days. Configurable via env var
 * `AGENT_SPEC_FRESHNESS_MAX_DAYS`. Test/dev override only — production
 * pre-commit should use the default.
 *
 * Run via:
 *   npm run check:agent-spec-freshness
 *   node scripts/check-agent-spec-freshness.mjs
 *   node scripts/check-agent-spec-freshness.mjs --json
 *
 * To refresh a spec after re-reading it:
 *   Edit `topology_last_verified:` to today's date (YYYY-MM-DD) and commit.
 *
 * Designed to be cheap (~50ms). Wires into `npm run check:all` alongside
 * check:topology + check:retry-storm + check:sentry-config + check:lockfile.
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, relative } from 'path'

const ROOT      = join(import.meta.dirname, '..')
const SPEC_DIR  = join(ROOT, '.claude', 'agents')
const MAX_DAYS  = Number(process.env.AGENT_SPEC_FRESHNESS_MAX_DAYS ?? 90)
const JSON_OUT  = process.argv.includes('--json')

const FIELD_RE  = /^topology_last_verified:\s*(\d{4}-\d{2}-\d{2})/m
const DATE_RE   = /^\d{4}-\d{2}-\d{2}$/

function rel(file) { return relative(ROOT, file).split('\\').join('/') }

function loadSpecs() {
  if (!existsSync(SPEC_DIR)) return []
  return readdirSync(SPEC_DIR)
    .filter(name => name.endsWith('.md'))
    .map(name => join(SPEC_DIR, name))
}

function parseFrontmatter(text) {
  // Frontmatter = first block between two `---` lines. Extract it as a
  // string then run targeted regexes; full YAML parse isn't worth the dep.
  const lines = text.split('\n')
  if (lines[0] !== '---') return null
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { end = i; break }
  }
  if (end === -1) return null
  return lines.slice(1, end).join('\n')
}

function daysSince(dateStr) {
  if (!DATE_RE.test(dateStr)) return null
  const then = Date.parse(dateStr + 'T00:00:00Z')
  if (Number.isNaN(then)) return null
  const now = Date.now()
  return Math.floor((now - then) / (24 * 60 * 60 * 1000))
}

function checkSpec(file) {
  const text = readFileSync(file, 'utf8')
  const fm   = parseFrontmatter(text)
  const result = { file: rel(file), status: 'pass', message: '', daysSince: null }

  if (fm === null) {
    result.status  = 'fail'
    result.message = 'No frontmatter block — spec must open with `---` ... `---` and include `topology_last_verified: YYYY-MM-DD`.'
    return result
  }
  const match = FIELD_RE.exec(fm)
  if (!match) {
    result.status  = 'fail'
    result.message = 'Missing `topology_last_verified: YYYY-MM-DD` field in frontmatter. Add today\'s date after re-reading the spec.'
    return result
  }
  const dateStr = match[1]
  const days    = daysSince(dateStr)
  result.daysSince = days
  if (days === null) {
    result.status  = 'fail'
    result.message = `Invalid date "${dateStr}" — must be YYYY-MM-DD.`
    return result
  }
  if (days < 0) {
    result.status  = 'fail'
    result.message = `Date "${dateStr}" is in the future (${-days}d). Are you time-travelling?`
    return result
  }
  if (days > MAX_DAYS) {
    result.status  = 'fail'
    result.message = `Stamped ${days}d ago (max ${MAX_DAYS}d). Re-read the spec — especially platform-topology references — then bump the field to today.`
    return result
  }
  return result
}

// ── Runner ───────────────────────────────────────────────────────────────────

const specs   = loadSpecs()
const results = specs.map(checkSpec)
const failed  = results.filter(r => r.status === 'fail')

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: failed.length === 0, results, maxDays: MAX_DAYS }, null, 2))
  process.exit(failed.length > 0 ? 1 : 0)
}

function color(code, s) { return process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s }
const red    = s => color('31', s)
const green  = s => color('32', s)
const yellow = s => color('33', s)
const dim    = s => color('2',  s)
const bold   = s => color('1',  s)

console.log(`\n🔍  Agent-spec freshness check\n    Repo: ${ROOT}\n    Threshold: ${MAX_DAYS} days\n`)

if (failed.length === 0) {
  console.log(green(bold(`✅  All ${results.length} agent spec(s) are fresh (within ${MAX_DAYS}d).`)))
  // Surface the oldest 3 specs so the operator sees what's coming up for re-read.
  const sorted = [...results].sort((a, b) => (b.daysSince ?? 0) - (a.daysSince ?? 0)).slice(0, 3)
  if (sorted.length > 0) {
    console.log(dim('   Oldest:'))
    for (const s of sorted) {
      console.log(dim(`     ${s.file}  (${s.daysSince}d ago)`))
    }
  }
  console.log()
  process.exit(0)
}

for (const r of results) {
  if (r.status === 'pass') continue
  console.log(`  ${red('FAIL')}  ${yellow(r.file)}  ${dim(r.daysSince !== null ? `(${r.daysSince}d ago)` : '')}`)
  console.log(`         ${dim('→ ' + r.message)}`)
}

console.log()
console.log(red(bold(`❌  ${failed.length} agent spec(s) need attention.`)))
console.log(dim('   To refresh a spec: re-read it (especially platform-topology references), then bump `topology_last_verified:` in the frontmatter to today\'s date (YYYY-MM-DD).'))
console.log(dim(`   Threshold: ${MAX_DAYS} days. Override (test/dev only) via AGENT_SPEC_FRESHNESS_MAX_DAYS env var.\n`))
process.exit(1)
