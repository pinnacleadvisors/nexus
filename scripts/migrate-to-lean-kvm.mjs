#!/usr/bin/env node
/**
 * migrate-to-lean-kvm.mjs — consolidate every Nexus service onto a single
 * Coolify KVM. Idempotent. Run via Doppler for env injection.
 *
 *   doppler run -- node scripts/migrate-to-lean-kvm.mjs --dry-run
 *   doppler run -- node scripts/migrate-to-lean-kvm.mjs --apply
 *   doppler run -- node scripts/migrate-to-lean-kvm.mjs --apply --stop-source
 *
 * What it does:
 *   1. For each service in services/<name>/docker-compose.{yml,yaml}:
 *      a. Check if a Coolify app with that name already exists on TARGET → skip
 *      b. Create a Compose application on TARGET, git-based (Coolify clones
 *         this repo and builds from the service's subdirectory)
 *      c. Bulk-PATCH every env var the Compose file references, sourcing
 *         values from process.env (Doppler-injected)
 *      d. Trigger an initial deploy
 *      e. Poll /applications/{uuid} until status reaches "running" or timeout
 *   2. (Optional, --stop-source) For each service, if SOURCE_COOLIFY_URL is
 *      set, find an app with the same name on the source Coolify and STOP
 *      it (never deletes — keeps the rollback path open).
 *
 * Inputs (env, sourced from Doppler):
 *   TARGET_COOLIFY_URL          (defaults to COOLIFY_KVM4_URL if unset)
 *   TARGET_COOLIFY_TOKEN        (defaults to COOLIFY_KVM4_API_TOKEN)
 *   TARGET_COOLIFY_PROJECT_UUID (defaults to COOLIFY_PROJECT_ID_NEXUS_BUSINESSES)
 *   TARGET_COOLIFY_SERVER_UUID  (defaults to COOLIFY_KVM4_SERVER_UUID)
 *   GIT_REPOSITORY              (defaults to https://github.com/pinnacleadvisors/nexus)
 *   GIT_BRANCH                  (defaults to main)
 *   SOURCE_COOLIFY_URL          (optional — KVM2 Coolify URL for --stop-source)
 *   SOURCE_COOLIFY_TOKEN        (optional)
 *   Plus every env referenced in each Compose file (CLAUDE_GATEWAY_BEARER,
 *   COOLIFY_API_KEY, NEXUS_SANDBOX_TOKEN, etc. — see service compose files)
 *
 * Exit codes:
 *   0  — all services migrated (or already in place)
 *   1  — bad CLI usage
 *   2  — missing required target config
 *   3  — at least one service failed to create / deploy
 */

import fs   from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

// ── Service list ──────────────────────────────────────────────────────────────
// Order matters only for logging; Coolify creates apps independently. The
// `name` becomes the Coolify application name (and the alias on the shared
// `coolify` network — see each service's docker-compose for the alias).
const SERVICES = [
  { name: 'claude-gateway', dir: 'services/claude-gateway' },
  { name: 'codex-gateway',  dir: 'services/codex-gateway'  },
  { name: 'nexus-sandbox',  dir: 'services/nexus-sandbox'  },
  { name: 'nexus-app',      dir: 'services/lean-deploy'    },
]

// ── CLI ───────────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2)
const DRY_RUN     = args.includes('--dry-run')
const APPLY       = args.includes('--apply')
const STOP_SOURCE = args.includes('--stop-source')
const ONLY        = (args.find(a => a.startsWith('--service=')) ?? '').split('=')[1] ?? null

if (!DRY_RUN && !APPLY) {
  console.error('Usage: doppler run -- node scripts/migrate-to-lean-kvm.mjs --dry-run | --apply [--stop-source] [--service=<name>]')
  process.exit(1)
}

// ── Config ────────────────────────────────────────────────────────────────────
const TARGET = {
  url:         process.env.TARGET_COOLIFY_URL         ?? process.env.COOLIFY_KVM4_URL,
  token:       process.env.TARGET_COOLIFY_TOKEN       ?? process.env.COOLIFY_KVM4_API_TOKEN,
  projectUuid: process.env.TARGET_COOLIFY_PROJECT_UUID ?? process.env.COOLIFY_PROJECT_ID_NEXUS_BUSINESSES,
  serverUuid:  process.env.TARGET_COOLIFY_SERVER_UUID  ?? process.env.COOLIFY_KVM4_SERVER_UUID,
}
const SOURCE = {
  url:   process.env.SOURCE_COOLIFY_URL,
  token: process.env.SOURCE_COOLIFY_TOKEN,
}
const GIT_REPOSITORY = process.env.GIT_REPOSITORY ?? 'https://github.com/pinnacleadvisors/nexus'
const GIT_BRANCH     = process.env.GIT_BRANCH     ?? 'main'

const missingTarget = Object.entries(TARGET).filter(([_, v]) => !v).map(([k]) => k)
if (missingTarget.length > 0) {
  console.error(`Missing target config: ${missingTarget.join(', ')}`)
  console.error('Set TARGET_COOLIFY_* or COOLIFY_KVM4_* in Doppler.')
  process.exit(2)
}
if (STOP_SOURCE && (!SOURCE.url || !SOURCE.token)) {
  console.error('--stop-source requires SOURCE_COOLIFY_URL and SOURCE_COOLIFY_TOKEN')
  process.exit(2)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function coolify(creds, method, path, body) {
  const url = `${creds.url.replace(/\/$/, '')}/api/v1${path}`
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'Authorization': `Bearer ${creds.token}`,
    },
    body:   body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45_000),
  })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text.slice(0, 500) } }
  if (!res.ok) {
    const err = new Error(`coolify ${method} ${path} → ${res.status}`)
    err.status = res.status
    err.body   = data
    throw err
  }
  return data
}

async function findAppByName(creds, name) {
  const apps = await coolify(creds, 'GET', '/applications')
  const list = Array.isArray(apps) ? apps : (apps?.data ?? [])
  return list.find(a => a.name === name) ?? null
}

async function readComposeFile(dir) {
  for (const filename of ['docker-compose.yml', 'docker-compose.yaml']) {
    const p = path.join(REPO_ROOT, dir, filename)
    try {
      const body = await fs.readFile(p, 'utf8')
      return { body, filename, relPath: `/${path.relative(REPO_ROOT, p)}` }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
  }
  throw new Error(`no docker-compose.{yml,yaml} in ${dir}`)
}

function extractEnvRefs(composeBody) {
  const matches = [...composeBody.matchAll(/\$\{([A-Z_][A-Z0-9_]*)(?::-[^}]*)?\}/g)]
  return [...new Set(matches.map(m => m[1]))]
}

function collectEnvValues(keys) {
  const present = []
  const missing = []
  for (const k of keys) {
    const v = process.env[k]
    if (v !== undefined && v !== '') present.push({ key: k, value: v })
    else missing.push(k)
  }
  return { present, missing }
}

// ── Per-service migration ────────────────────────────────────────────────────
async function migrateService(svc) {
  const log = (msg) => console.log(`  [${svc.name}] ${msg}`)
  console.log(`\n→ ${svc.name}  (${svc.dir})`)

  const existing = await findAppByName(TARGET, svc.name)
  if (existing) {
    log(`already on target  uuid=${existing.uuid}  status=${existing.status ?? '?'}`)
    return { name: svc.name, action: 'skipped', uuid: existing.uuid }
  }

  const compose = await readComposeFile(svc.dir)
  const envRefs = extractEnvRefs(compose.body)
  const { present, missing } = collectEnvValues(envRefs)
  log(`compose: ${compose.filename}  envs: ${present.length} present, ${missing.length} missing`)
  if (missing.length > 0) {
    log(`  ⚠️  not set: ${missing.join(', ')}`)
  }

  if (DRY_RUN) {
    log(`[dry-run] would create app + set ${present.length} envs + deploy`)
    return { name: svc.name, action: 'dry-run', envs: present.length, missing }
  }

  // Create the Compose application. Git-based so Coolify clones the repo and
  // builds from the service's subdirectory using its own docker-compose file.
  let created
  try {
    created = await coolify(TARGET, 'POST', '/applications/dockercompose', {
      name:                     svc.name,
      project_uuid:             TARGET.projectUuid,
      server_uuid:              TARGET.serverUuid,
      environment_name:         'production',
      git_repository:           GIT_REPOSITORY,
      git_branch:               GIT_BRANCH,
      base_directory:           `/${svc.dir}`,
      docker_compose_location:  `/${compose.filename}`,
      instant_deploy:           false,
    })
  } catch (err) {
    log(`❌ create failed: ${err.message}`)
    if (err.body) log(`   body: ${JSON.stringify(err.body).slice(0, 400)}`)
    return { name: svc.name, action: 'failed', stage: 'create', error: err.message }
  }
  const uuid = created.uuid ?? created.application?.uuid ?? created.data?.uuid
  if (!uuid) {
    log(`❌ create returned no uuid: ${JSON.stringify(created).slice(0, 200)}`)
    return { name: svc.name, action: 'failed', stage: 'create', error: 'no uuid in response' }
  }
  log(`created  uuid=${uuid}`)

  if (present.length > 0) {
    try {
      await coolify(TARGET, 'PATCH', `/applications/${uuid}/envs/bulk`, {
        data: present.map(e => ({
          key:           e.key,
          value:         e.value,
          is_build_time: false,
          is_preview:    false,
          is_literal:    false,
        })),
      })
      log(`set ${present.length} envs`)
    } catch (err) {
      log(`⚠️  env-set failed (continuing): ${err.message}`)
    }
  }

  try {
    await coolify(TARGET, 'POST', `/applications/${uuid}/deploy`)
    log('deploy triggered')
  } catch (err) {
    log(`❌ deploy failed: ${err.message}`)
    return { name: svc.name, action: 'failed', stage: 'deploy', uuid, error: err.message }
  }

  // Poll for healthy state — Coolify reports status="running" / "exited" / etc.
  const deadline = Date.now() + 5 * 60 * 1000
  let lastStatus = '?'
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 10_000))
    try {
      const app = await coolify(TARGET, 'GET', `/applications/${uuid}`)
      lastStatus = String(app?.status ?? app?.data?.status ?? '?').toLowerCase()
      log(`status=${lastStatus}`)
      if (lastStatus.includes('running')) break
      if (lastStatus.includes('exited') || lastStatus.includes('failed')) {
        return { name: svc.name, action: 'failed', stage: 'health', uuid, status: lastStatus }
      }
    } catch (err) {
      log(`status check error: ${err.message}`)
    }
  }
  if (!lastStatus.includes('running')) {
    log(`⚠️  did not reach running within 5min (lastStatus=${lastStatus})`)
  }

  // Optional source-side stop. Defensive — never delete; lets the operator
  // re-start on KVM2 if the cutover needs to be rolled back.
  if (STOP_SOURCE) {
    try {
      const sourceApp = await findAppByName(SOURCE, svc.name)
      if (sourceApp) {
        await coolify(SOURCE, 'POST', `/applications/${sourceApp.uuid}/stop`)
        log(`stopped on source  uuid=${sourceApp.uuid}`)
      } else {
        log('not found on source — nothing to stop')
      }
    } catch (err) {
      log(`⚠️  source stop failed (continuing): ${err.message}`)
    }
  }

  return { name: svc.name, action: 'created', uuid, status: lastStatus }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('migrate-to-lean-kvm')
  console.log(`  target:        ${TARGET.url}  project=${TARGET.projectUuid}  server=${TARGET.serverUuid}`)
  console.log(`  source:        ${SOURCE.url ?? '(none)'}  (${STOP_SOURCE ? 'will stop' : 'leave running'})`)
  console.log(`  git:           ${GIT_REPOSITORY}#${GIT_BRANCH}`)
  console.log(`  mode:          ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}`)
  if (ONLY) console.log(`  service filter: ${ONLY}`)

  const targetList = ONLY ? SERVICES.filter(s => s.name === ONLY) : SERVICES
  if (targetList.length === 0) {
    console.error(`No matching service: ${ONLY}`)
    process.exit(1)
  }

  const results = []
  for (const svc of targetList) {
    try {
      const r = await migrateService(svc)
      results.push(r)
    } catch (err) {
      console.log(`  [${svc.name}] ❌ unexpected error: ${err.message}`)
      results.push({ name: svc.name, action: 'failed', stage: 'unexpected', error: err.message })
    }
  }

  console.log('\n── summary ──────────────────────')
  for (const r of results) {
    const tag = r.action === 'created' ? '✓ created'
              : r.action === 'skipped' ? '· already there'
              : r.action === 'dry-run' ? '~ would-create'
              :                          '✗ failed'
    console.log(`  ${tag.padEnd(18)} ${r.name}${r.uuid ? `  uuid=${r.uuid}` : ''}${r.error ? `  err=${r.error}` : ''}`)
  }

  const failed = results.filter(r => r.action === 'failed')
  if (failed.length > 0) {
    console.error(`\n${failed.length} service(s) failed`)
    process.exit(3)
  }
  console.log('\nok')
}

main().catch(err => {
  console.error(err)
  process.exit(3)
})
