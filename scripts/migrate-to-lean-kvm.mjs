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
 * Inputs (env, sourced from Doppler — these are the established Nexus names):
 *   COOLIFY_KVM4_URL                    target Coolify host
 *   COOLIFY_KVM4_API_TOKEN              target Coolify PAT
 *   COOLIFY_KVM4_SERVER_UUID            target server uuid
 *   COOLIFY_PROJECT_ID_NEXUS_PLATFORM   project uuid for the lean-mode stack
 *                                       (the "Nexus Platform" project — NOT
 *                                       COOLIFY_PROJECT_ID_NEXUS_BUSINESSES,
 *                                       which is the per-business project)
 *                                       If unset, the script auto-discovers
 *                                       the project named "Nexus Platform"
 *                                       via GET /projects.
 *   GIT_REPOSITORY                      defaults to https://github.com/pinnacleadvisors/nexus
 *   GIT_BRANCH                          defaults to main
 *   SOURCE_COOLIFY_URL                  optional — source Coolify URL for --stop-source
 *   SOURCE_COOLIFY_TOKEN                optional
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
import { printDocPropagationBanner } from './lib-migration-banner.mjs'

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
  // n8n — migrated from Hostinger KVM1 (expired 2026-05-22). SQLite-
  // backed; pulls N8N_ENCRYPTION_KEY + N8N_BASIC_AUTH_* from Doppler.
  // After the FIRST deploy, stop the container and restore the KVM1
  // data tarball into the n8n_data volume before restarting. See
  // docs/runbooks/n8n-kvm1-to-coolify.md for the operator procedure.
  { name: 'n8n',            dir: 'services/n8n'            },
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
// Reads the established COOLIFY_KVM4_* names already in Doppler.
// project_uuid is resolved at runtime — see resolveProject() below.
const TARGET = {
  url:         process.env.COOLIFY_KVM4_URL,
  token:       process.env.COOLIFY_KVM4_API_TOKEN,
  projectUuid: null, // populated by resolveProject() before main()
  projectId:   null, // numeric — used for cross-project app detection
  projectName: null, // for logging
  serverUuid:  process.env.COOLIFY_KVM4_SERVER_UUID,
}
const SOURCE = {
  url:   process.env.SOURCE_COOLIFY_URL,
  token: process.env.SOURCE_COOLIFY_TOKEN,
}
const GIT_REPOSITORY = process.env.GIT_REPOSITORY ?? 'https://github.com/pinnacleadvisors/nexus'
const GIT_BRANCH     = process.env.GIT_BRANCH     ?? 'main'

const missingTarget = ['url', 'token', 'serverUuid'].filter(k => !TARGET[k])
if (missingTarget.length > 0) {
  const ENV_NAMES = {
    url:         'COOLIFY_KVM4_URL',
    token:       'COOLIFY_KVM4_API_TOKEN',
    serverUuid:  'COOLIFY_KVM4_SERVER_UUID',
  }
  console.error(`Missing Doppler env: ${missingTarget.map(k => ENV_NAMES[k]).join(', ')}`)
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

/**
 * Look up an app by name. Returns the first match, or null.
 *
 * Why not stricter project-membership filtering: Coolify's GET /applications
 * doesn't return a usable project identifier, and the documented
 * `repository_project_id` on GET /applications/{uuid} doesn't match the
 * target project's numeric `id` reliably (turns out to be a different
 * relationship — Coolify's data model links apps to Environments, not
 * directly to Projects, and the cleanest mapping isn't exposed via API).
 *
 * Trust model: the operator sets COOLIFY_PROJECT_ID_NEXUS_PLATFORM
 * explicitly. We pass that on create so new apps land in the right place.
 * If two apps share a name across projects, we operate on whichever the
 * API returns first — flagged in the warning below.
 */
async function findMatchingApps(creds, name) {
  const apps = await coolify(creds, 'GET', '/applications')
  const list = Array.isArray(apps) ? apps : (apps?.data ?? [])
  return list.filter(a => a.name === name)
}

/**
 * Resolve the target project — env override first, then auto-discover the
 * project named "Nexus Platform" via GET /projects. Returns { id, uuid, name }.
 * Throws with a clear message on missing / ambiguous discovery.
 */
async function resolveProject(creds) {
  const fromEnv = process.env.COOLIFY_PROJECT_ID_NEXUS_PLATFORM
  if (fromEnv) {
    try {
      const p = await coolify(creds, 'GET', `/projects/${fromEnv}`)
      return { id: p?.id, uuid: fromEnv, name: p?.name ?? '(unnamed)', source: 'env' }
    } catch (err) {
      throw new Error(
        `COOLIFY_PROJECT_ID_NEXUS_PLATFORM=${fromEnv} but the project doesn't exist: ${err.message}`,
      )
    }
  }
  // Auto-discover by name. Case-insensitive, allows "Nexus Platform" / "nexus-platform" / etc.
  const projects = await coolify(creds, 'GET', '/projects')
  const list = Array.isArray(projects) ? projects : (projects?.data ?? [])
  const matches = list.filter(p => /^\s*nexus[\s_-]*platform\s*$/i.test(String(p?.name ?? '')))
  if (matches.length === 0) {
    const available = list.map(p => `"${p?.name ?? '?'}" (${p?.uuid ?? '?'})`).join(', ')
    throw new Error(
      'No project named "Nexus Platform" found in target Coolify.\n' +
      `  Available projects: ${available || '(none)'}\n` +
      '  Fix: set COOLIFY_PROJECT_ID_NEXUS_PLATFORM in Doppler with the project uuid,\n' +
      '       or rename the target project in Coolify UI to "Nexus Platform".'
    )
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple projects match "Nexus Platform": ${matches.map(p => p.name).join(', ')}. ` +
      'Set COOLIFY_PROJECT_ID_NEXUS_PLATFORM in Doppler explicitly.'
    )
  }
  return { id: matches[0].id, uuid: matches[0].uuid, name: matches[0].name, source: 'discovered' }
}

async function readComposeFile(dir) {
  for (const filename of ['docker-compose.yaml', 'docker-compose.yml']) {
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

  // Look up by name. The operator's COOLIFY_PROJECT_ID_NEXUS_PLATFORM tells
  // us where new apps should land; the trust model is that they verified
  // the existing apps live there already (Coolify UI is the authoritative
  // view). If multiple matches exist across projects, surface a soft
  // warning but operate on whichever the API returns first.
  const matches = await findMatchingApps(TARGET, svc.name)
  if (matches.length > 0) {
    if (matches.length > 1) {
      log(`⚠️  ${matches.length} apps named '${svc.name}' exist across projects — likely cross-project duplicates from earlier runs.`)
      log(`    operating on the first (uuid=${matches[0].uuid}). Inspect Coolify UI to clean up the others:`)
      for (const m of matches.slice(1)) {
        log(`      - extra match: uuid=${m.uuid}  status=${m.status ?? '?'}`)
      }
    }
    const existing = matches[0]
    const status = String(existing.status ?? '?').toLowerCase()
    log(`already on target  uuid=${existing.uuid}  status=${existing.status ?? '?'}`)
    if (!status.includes('running:healthy')) {
      log(`  ⚠️  app is not running:healthy — script won't re-deploy existing apps.`)
      log(`     check logs in Coolify UI, or trigger a manual redeploy:`)
      log(`       curl -X GET '${TARGET.url}/api/v1/deploy?uuid=${existing.uuid}&force=true' \\`)
      log(`            -H "Authorization: Bearer $COOLIFY_KVM4_API_TOKEN"`)
    }
    return { name: svc.name, action: 'skipped', uuid: existing.uuid, status }
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

  // Create the application. Use /applications/public for repo-cloned Compose
  // builds — the /applications/dockercompose endpoint is deprecated and
  // accepts only inline (base64) Compose, not git-based.
  //
  // When the repo flips to private + a Coolify GitHub App is registered,
  // switch this to POST /applications/private-github-app and add the field
  // `github_app_uuid: <uuid>` (from Coolify Sources page). The rest of the
  // shape stays the same.
  let created
  try {
    created = await coolify(TARGET, 'POST', '/applications/public', {
      name:                     svc.name,
      project_uuid:             TARGET.projectUuid,
      server_uuid:              TARGET.serverUuid,
      environment_name:         'production',
      git_repository:           GIT_REPOSITORY,
      git_branch:               GIT_BRANCH,
      build_pack:               'dockercompose',
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
    // Coolify v4 deploy endpoint is top-level (GET /deploy?uuid=…), NOT
    // /applications/{uuid}/deploy (which 404s). Force=true does a fresh build
    // without cache — good for first deploy since there's nothing to cache.
    await coolify(TARGET, 'GET', `/deploy?uuid=${uuid}&force=true`)
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

// Redact env-sourced values in the startup log. We want enough to confirm
// "yes, configuration is loaded and pointing at the right host/project",
// without printing full URLs or UUIDs that may identify private infra.
function redactUrl(u) {
  if (!u) return '(unset)'
  try { return new URL(u).host } catch { return '(invalid)' }
}
function redactId(id) {
  if (!id) return '(unset)'
  if (id.length <= 12) return '***'
  return `${id.slice(0, 6)}…${id.slice(-4)}`
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('migrate-to-lean-kvm')
  console.log(`  target host:   ${redactUrl(TARGET.url)}`)
  console.log(`  target server: ${redactId(TARGET.serverUuid)}`)

  // Resolve the target project BEFORE anything else so we know we're pointing
  // at "Nexus Platform", not "nexus-businesses" or some other project.
  let project
  try {
    project = await resolveProject(TARGET)
  } catch (err) {
    console.error(`\n❌ Could not resolve target project:\n  ${err.message}`)
    process.exit(2)
  }
  TARGET.projectUuid = project.uuid
  TARGET.projectId   = project.id
  TARGET.projectName = project.name
  console.log(`  target project: '${project.name}'  uuid=${redactId(project.uuid)}  (source: ${project.source})`)

  console.log(`  source:        host=${redactUrl(SOURCE.url)}  (${STOP_SOURCE ? 'will stop' : 'leave running'})`)
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

  // Only nudge after a real --apply, never on --dry-run.
  if (APPLY) {
    printDocPropagationBanner({
      scriptName: 'migrate-to-lean-kvm',
      extras: [
        `KVM2 / KVM1 hostnames the source services used are now retired — confirm npm run check:topology passes.`,
        `If the migration moved the codex-gateway, update CODEX_GATEWAY_URL in Doppler prd to point at the new host.`,
      ],
    })
  }
}

main().catch(err => {
  console.error(err)
  process.exit(3)
})
