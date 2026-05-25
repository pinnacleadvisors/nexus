#!/usr/bin/env node
/**
 * scripts/install-gbrain-sandbox.mjs — clone + run GBrain in the local sandbox.
 *
 * Per task_plan-gbrain-integration.md Phase 1 (Explore). This script does
 * the bare minimum so the operator can verify GBrain is installable and
 * the tutorial reproduces, then exposes the local endpoint as
 * GBRAIN_BASE_URL so the GBrain ecosystem adapter wires through.
 *
 * Honours the platform pattern: never run anything that writes outside
 * services/nexus-sandbox/ or modifies the system. Idempotent — re-running
 * is a no-op when GBrain is already cloned + running.
 *
 * Usage:
 *   node scripts/install-gbrain-sandbox.mjs            # full install
 *   node scripts/install-gbrain-sandbox.mjs --check    # verify only
 *   node scripts/install-gbrain-sandbox.mjs --uninstall
 *
 * After install, set in Doppler:
 *   GBRAIN_BASE_URL=http://localhost:7777
 *   (optional) GBRAIN_API_KEY=<from gbrain config>
 */

import { existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'

const SANDBOX_ROOT = resolve(process.cwd(), 'services', 'nexus-sandbox', 'gbrain')
const REPO_URL     = 'https://github.com/garrytan/gbrain'

const args = process.argv.slice(2)
const CHECK     = args.includes('--check')
const UNINSTALL = args.includes('--uninstall')

function run(cmd, cmdArgs, opts = {}) {
  console.log('$', cmd, cmdArgs.join(' '))
  const res = spawnSync(cmd, cmdArgs, { stdio: 'inherit', cwd: opts.cwd ?? process.cwd() })
  if (res.status !== 0) {
    console.error(`exit ${res.status}`)
    process.exit(res.status ?? 1)
  }
}

function exists(path) { return existsSync(path) }

if (UNINSTALL) {
  console.log(`removing ${SANDBOX_ROOT}`)
  run('rm', ['-rf', SANDBOX_ROOT])
  console.log('done. Also unset GBRAIN_BASE_URL in Doppler.')
  process.exit(0)
}

if (CHECK) {
  console.log(`check:    sandbox dir   ${exists(SANDBOX_ROOT) ? 'present' : 'absent'}`)
  console.log(`check:    GBRAIN_BASE_URL ${process.env.GBRAIN_BASE_URL ? 'set' : 'unset'}`)
  // Try a quick health probe if URL is set.
  if (process.env.GBRAIN_BASE_URL) {
    try {
      const res = await fetch(`${process.env.GBRAIN_BASE_URL}/health`, {
        signal: AbortSignal.timeout(3000),
      })
      console.log(`probe:    ${res.status} ${res.statusText}`)
    } catch (e) {
      console.log(`probe:    unreachable (${e.message})`)
    }
  }
  process.exit(0)
}

// Install path.
if (!exists(SANDBOX_ROOT)) {
  console.log(`cloning ${REPO_URL} → ${SANDBOX_ROOT}`)
  mkdirSync(resolve(SANDBOX_ROOT, '..'), { recursive: true })
  run('git', ['clone', '--depth', '1', REPO_URL, SANDBOX_ROOT])
} else {
  console.log(`already cloned at ${SANDBOX_ROOT} — skipping clone`)
}

// Inspect what we got. Different repos ship different bootstrap commands;
// this script TRIES Python venv first (most common for memory/AI repos),
// then docker-compose. Operator can override by reading the GBrain README.
const composeFile = join(SANDBOX_ROOT, 'docker-compose.yaml')
const requirements = join(SANDBOX_ROOT, 'requirements.txt')
const packageJson  = join(SANDBOX_ROOT, 'package.json')

if (exists(composeFile)) {
  console.log('found docker-compose.yaml — bringing up containers')
  run('docker', ['compose', 'up', '-d'], { cwd: SANDBOX_ROOT })
  console.log('GBrain should be reachable at http://localhost:7777 (or per compose)')
} else if (exists(requirements)) {
  console.log('found requirements.txt — set up Python venv manually:')
  console.log(`  cd ${SANDBOX_ROOT} && python -m venv .venv && .venv/bin/pip install -r requirements.txt`)
} else if (exists(packageJson)) {
  console.log('found package.json — installing + starting')
  run('npm', ['install'], { cwd: SANDBOX_ROOT })
  console.log(`then start with: cd ${SANDBOX_ROOT} && npm run start`)
} else {
  console.log('no recognised bootstrap. Read GBrain README:')
  console.log(`  cat ${SANDBOX_ROOT}/README.md`)
}

console.log('')
console.log('next steps:')
console.log('  1. confirm GBrain is reachable (curl <base_url>/health)')
console.log('  2. doppler secrets set GBRAIN_BASE_URL=<url>')
console.log('  3. (optional) doppler secrets set GBRAIN_API_KEY=<key>')
console.log('  4. run: node scripts/eval-memory.mjs to benchmark')
