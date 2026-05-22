#!/usr/bin/env node
/**
 * scripts/check-lockfile.mjs
 *
 * Detects drift between `package.json` and `package-lock.json`.
 *
 * Catches the PR-274 incident class: a PR adds a new dependency to
 * package.json AND inserts the root-deps line into package-lock.json BUT
 * forgets the `node_modules/<dep>` entry with resolved URL + integrity +
 * transitive deps. Result on the operator's machine: `npm install` is
 * ambiguous, `npm run dev` fails with "Module not found".
 *
 * Two-tier check:
 *
 *   1. Fast custom check (< 100 ms) — every package.json dep MUST have both
 *      a root-deps entry AND a `node_modules/<dep>` packages entry in the
 *      lockfile. Catches the specific PR-274 failure mode.
 *
 *   2. Authoritative `npm ci --dry-run` (~3-5s) — only runs if the fast
 *      check passes. Catches subtler drift (version mismatches, phantom
 *      entries, conflicting peer deps).
 *
 * Exit 0 on clean, exit 1 on drift. Designed to be wired into
 * `npm run check:all` so a partial-lockfile PR fails CI before reaching
 * the operator's machine.
 */

import { promises as fs } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const RED   = '\x1b[31m'
const GREEN = '\x1b[32m'
const YEL   = '\x1b[33m'
const DIM   = '\x1b[2m'
const RST   = '\x1b[0m'

function fail(msg) { console.error(`${RED}✗${RST} ${msg}`) }
function warn(msg) { console.error(`${YEL}!${RST} ${msg}`) }
function ok(msg)   { console.log(`${GREEN}✓${RST} ${msg}`)  }
function info(msg) { console.log(`  ${msg}`) }
function dim(msg)  { console.log(`${DIM}  ${msg}${RST}`)    }

console.log(`🔍  Lockfile drift static check\n    Repo: ${process.cwd()}\n`)

// ── 1. Fast custom check ─────────────────────────────────────────────────────

let pkg
let lock
try {
  pkg  = JSON.parse(await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8'))
  lock = JSON.parse(await fs.readFile(path.join(process.cwd(), 'package-lock.json'), 'utf8'))
} catch (err) {
  fail(`could not read package.json / package-lock.json: ${err instanceof Error ? err.message : err}`)
  process.exit(2)
}

const declaredDeps = {
  ...(pkg.dependencies ?? {}),
  ...(pkg.devDependencies ?? {}),
  ...(pkg.optionalDependencies ?? {}),
}

const lockPackages   = lock.packages    ?? {}
const lockRootDeps   = lockPackages['']?.dependencies    ?? {}
const lockRootDev    = lockPackages['']?.devDependencies ?? {}
const lockRootOpt    = lockPackages['']?.optionalDependencies ?? {}
const lockRootAllDeps = { ...lockRootDeps, ...lockRootDev, ...lockRootOpt }

const fastFailures = []

for (const name of Object.keys(declaredDeps)) {
  const declaredVersion = declaredDeps[name]
  const inRoot          = lockRootAllDeps[name]
  const inPackages      = lockPackages[`node_modules/${name}`]

  if (!inRoot) {
    fastFailures.push({
      pkg: name,
      issue: `declared in package.json (${declaredVersion}) but MISSING from package-lock.json root dependencies block`,
    })
  } else if (!inPackages) {
    fastFailures.push({
      pkg: name,
      issue: `declared in package.json (${declaredVersion}) AND in lockfile root deps, but MISSING from "node_modules/${name}" lockfile entry (no resolved URL / integrity) — npm install will be inconsistent`,
    })
  } else if (inPackages.version && !satisfiesRoughly(declaredVersion, inPackages.version)) {
    fastFailures.push({
      pkg: name,
      issue: `version drift — package.json declares "${declaredVersion}" but lockfile has version ${inPackages.version}`,
    })
  }
}

if (fastFailures.length > 0) {
  fail(`Fast check failed — ${fastFailures.length} package.json ↔ package-lock.json drift${fastFailures.length === 1 ? '' : 's'}:\n`)
  for (const f of fastFailures) {
    console.error(`  ${RED}✗${RST} ${f.pkg}`)
    info(`  ${f.issue}`)
  }
  console.error('')
  console.error(`${YEL}Likely cause:${RST} a recent PR updated package.json without fully updating package-lock.json.`)
  console.error('')
  console.error('Fix on the PR branch:')
  console.error('  npm install            # rebuilds the lockfile entries')
  console.error('  git add package-lock.json')
  console.error('  git commit --amend     # or a separate "fix(lockfile)" commit')
  console.error('')
  process.exit(1)
}

ok(`Fast check passed — every package.json dep has matching root + node_modules entries in the lockfile`)
info(`(${Object.keys(declaredDeps).length} declared deps checked)`)

// ── 2. Authoritative npm ci --dry-run ────────────────────────────────────────

console.log(`\n${DIM}  Running \`npm ci --dry-run\` for the authoritative consistency check (this takes 3-5s)…${RST}`)

const result = spawnSync('npm', ['ci', '--dry-run'], {
  encoding: 'utf8',
  stdio:    ['ignore', 'pipe', 'pipe'],
})

if (result.status === 0) {
  ok('Authoritative `npm ci --dry-run` succeeded — lockfile is fully consistent with package.json')
  process.exit(0)
}

// `npm ci --dry-run` failed — surface what npm said.
fail('Authoritative `npm ci --dry-run` failed')
console.error('')
console.error(`${DIM}  npm stderr:${RST}`)
console.error('')
const stderr = result.stderr || result.stdout || '<empty>'
console.error(stderr.split('\n').map(l => `    ${l}`).join('\n'))
console.error('')
console.error(`${YEL}Likely cause:${RST} version conflict, phantom lockfile entry, or peer-dep mismatch.`)
console.error('Fix on the PR branch:')
console.error('  rm -rf node_modules package-lock.json')
console.error('  npm install            # regenerate from package.json')
console.error('  git add package-lock.json')
console.error('  # commit; the lockfile diff is expected to be large but is correct')
process.exit(1)

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Lax semver match: we don't pull in semver as a dep. Just normalises and
 * compares major.minor when the declared version is a caret/tilde range.
 * If they disagree on major, that's a definite drift. Anything more subtle
 * is left to `npm ci --dry-run` for the authoritative check.
 */
function satisfiesRoughly(declared, locked) {
  if (!declared || !locked) return true
  // Tag / file / git / link references — skip; can't compare numerically.
  if (/[a-zA-Z]/.test(declared.replace(/^[\^~>=<*]+/, '')[0] ?? '')) return true
  if (/^(file:|link:|git\+|github:|workspace:)/.test(declared)) return true

  const declMajor = parseInt(declared.replace(/^[\^~>=<* ]+/, '').split('.')[0] ?? '', 10)
  const lockMajor = parseInt((locked.split('.')[0] ?? ''), 10)
  if (!Number.isFinite(declMajor) || !Number.isFinite(lockMajor)) return true
  return declMajor === lockMajor
}
