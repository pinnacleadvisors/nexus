#!/usr/bin/env node
/**
 * coolify-create-compose-app.mjs — create a Docker Compose resource on a
 * Coolify v4 instance via the REST API.
 *
 * Pairs with scripts/cloudflare-tunnel-add-hostname.mjs: that script wires
 * the tunnel ingress hostname, this script creates the underlying Coolify
 * resource. Use them back-to-back when bringing up a new self-hosted service
 * (qa-runner, n8n, vector-shipper, etc.).
 *
 * Convention: the docker-compose.yaml referenced by --compose should follow
 * the Doppler-as-source-of-truth pattern in AGENTS.md §"Docker images —
 * Doppler as the source of truth". The only env var Coolify needs to set
 * is DOPPLER_TOKEN, which this script wires automatically if the operator
 * passes --doppler-token-secret=<doppler secret name holding the token>.
 *
 * Usage:
 *   doppler run -- node scripts/coolify-create-compose-app.mjs \
 *     --name=qa-runner \
 *     --compose=services/qa-runner/docker-compose.yaml \
 *     --doppler-token-secret=QA_RUNNER_DOPPLER_TOKEN \
 *     --dry-run
 *
 *   doppler run -- node scripts/coolify-create-compose-app.mjs \
 *     --name=qa-runner \
 *     --compose=services/qa-runner/docker-compose.yaml \
 *     --doppler-token-secret=QA_RUNNER_DOPPLER_TOKEN \
 *     --apply
 *
 * Optional flags:
 *   --project=<project-name-or-uuid>   default: first project visible to the token
 *   --server=<server-name-or-uuid>     default: first server visible to the token
 *   --environment=<env-name>           default: "production"
 *   --deploy                            also trigger an initial deploy after create
 *
 * Required env (sourced from Doppler):
 *   COOLIFY_KVM4_URL                   e.g. https://app.coolify.io OR your self-hosted URL
 *   COOLIFY_KVM4_API_TOKEN             personal access token
 *   <whatever --doppler-token-secret points at> — the service token to bake into the new resource
 */

import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
function arg(name) {
  const a = args.find(x => x.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : null
}
function flag(name) {
  return args.includes(`--${name}`)
}

const COOLIFY_URL   = process.env.COOLIFY_KVM4_URL?.replace(/\/$/, '')
const COOLIFY_TOKEN = process.env.COOLIFY_KVM4_API_TOKEN

const NAME       = arg('name')
const COMPOSE    = arg('compose')
const DOPPLER_SECRET_NAME = arg('doppler-token-secret')
const PROJECT    = arg('project')        // optional — name or uuid
const SERVER     = arg('server')         // optional — name or uuid
const ENV_NAME   = arg('environment') ?? 'production'
const DRY_RUN    = flag('dry-run')
const APPLY      = flag('apply')
const ALSO_DEPLOY = flag('deploy')

if (!COOLIFY_URL || !COOLIFY_TOKEN) {
  console.error('Missing COOLIFY_KVM4_URL or COOLIFY_KVM4_API_TOKEN. Run via `doppler run --`.')
  process.exit(2)
}
if (!NAME || !COMPOSE) {
  console.error('Usage: --name=<resource-name> --compose=<path-to-yaml> [--doppler-token-secret=<DOPPLER_VAR_NAME>] [--project=... --server=...] [--dry-run | --apply] [--deploy]')
  process.exit(2)
}
if (!DRY_RUN && !APPLY) {
  console.error('Must pass --dry-run or --apply.')
  process.exit(2)
}

let composeYaml
try {
  composeYaml = readFileSync(COMPOSE, 'utf8')
} catch (err) {
  console.error(`Failed to read ${COMPOSE}: ${err.message}`)
  process.exit(2)
}

// Coolify v4 expects docker_compose_raw to be base64-encoded (validated
// 2026-05-23 against https://coolify.coolifycloudtunnel.uk — sending raw
// YAML returns 422 "The docker_compose_raw should be base64 encoded.").
const composeYamlB64 = Buffer.from(composeYaml, 'utf8').toString('base64')

const DOPPLER_TOKEN_VALUE = DOPPLER_SECRET_NAME ? process.env[DOPPLER_SECRET_NAME] : null
if (DOPPLER_SECRET_NAME && !DOPPLER_TOKEN_VALUE) {
  console.error(`--doppler-token-secret=${DOPPLER_SECRET_NAME} but $${DOPPLER_SECRET_NAME} is unset — did you run via \`doppler run --\` against a config that has it?`)
  process.exit(2)
}

async function api(path, opts = {}) {
  const url = `${COOLIFY_URL}/api/v1${path}`
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${COOLIFY_TOKEN}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      ...(opts.headers ?? {}),
    },
  })
  let json
  const text = await res.text()
  try { json = text ? JSON.parse(text) : null } catch {
    throw new Error(`Coolify ${path}: HTTP ${res.status} — non-JSON body: ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    const detail = json?.message ?? json?.error ?? text.slice(0, 200)
    throw new Error(`Coolify ${opts.method ?? 'GET'} ${path} → HTTP ${res.status}: ${detail}`)
  }
  return json
}

function pickByNameOrUuid(items, idOrName, label) {
  if (!idOrName) return items[0]
  return items.find(x => x.uuid === idOrName)
      ?? items.find(x => x.name === idOrName)
      ?? (() => { throw new Error(`No ${label} matches "${idOrName}" — visible: ${items.map(x => x.name).join(', ')}`) })()
}

async function main() {
  console.log(`→ Coolify host: ${COOLIFY_URL}`)
  console.log(`→ Listing projects + servers visible to the API token…`)

  const projects = await api('/projects')
  const servers  = await api('/servers')

  if (!Array.isArray(projects) || !projects.length) {
    throw new Error('Token has no project access. Check Coolify → Keys & Tokens → token scope.')
  }
  if (!Array.isArray(servers) || !servers.length) {
    throw new Error('Token has no server access. Check Coolify → Keys & Tokens → token scope.')
  }

  const project = pickByNameOrUuid(projects, PROJECT, 'project')
  const server  = pickByNameOrUuid(servers,  SERVER,  'server')

  console.log(`  Project:     ${project.name} (${project.uuid})`)
  console.log(`  Server:      ${server.name}  (${server.uuid})`)
  console.log(`  Environment: ${ENV_NAME}`)
  console.log(`  Compose file: ${COMPOSE} (${composeYaml.length} bytes)`)
  if (DOPPLER_SECRET_NAME) {
    console.log(`  DOPPLER_TOKEN: from $${DOPPLER_SECRET_NAME} (length=${DOPPLER_TOKEN_VALUE.length}; value redacted)`)
  } else {
    console.log(`  DOPPLER_TOKEN: not provided (operator can set it via Coolify env pane later)`)
  }

  // Skim the project's existing services so we don't accidentally collide.
  // Coolify v4 returns services under /api/v1/services or nested under the
  // project — try the flat endpoint first.
  let existing = []
  try {
    const all = await api('/services')
    existing = Array.isArray(all) ? all.filter(s => s.project_uuid === project.uuid) : []
    const collision = existing.find(s => s.name === NAME)
    if (collision) {
      throw new Error(`A service named "${NAME}" already exists in project ${project.name} (uuid: ${collision.uuid}). Pick a different --name or delete the existing one first.`)
    }
  } catch (err) {
    if (!String(err.message).includes('already exists')) {
      console.warn(`  (could not enumerate existing services — proceeding anyway: ${err.message})`)
    } else {
      throw err
    }
  }

  if (DRY_RUN) {
    console.log(`\n[DRY-RUN] Would POST /services with body:`)
    console.log(JSON.stringify({
      // Coolify v4: type vs docker_compose_raw are mutually exclusive.
      // Providing docker_compose_raw signals "custom compose" — omit type.
      name:               NAME,
      project_uuid:       project.uuid,
      server_uuid:        server.uuid,
      environment_name:   ENV_NAME,
      docker_compose_raw: '<composeYaml truncated>',
    }, null, 2))
    if (DOPPLER_SECRET_NAME) {
      console.log(`\n[DRY-RUN] Would then POST /services/{uuid}/envs with:`)
      console.log(JSON.stringify({ key: 'DOPPLER_TOKEN', value: '<redacted>' }, null, 2))
    }
    if (ALSO_DEPLOY) {
      console.log(`\n[DRY-RUN] Would then POST /services/{uuid}/start`)
    }
    return
  }

  console.log(`\n→ Creating Compose service "${NAME}"…`)
  const created = await api('/services', {
    method: 'POST',
    body:   JSON.stringify({
      // Coolify v4 422s if both type and docker_compose_raw are sent —
      // they're mutually exclusive. Providing raw compose signals "custom"
      // (vs templated services like wordpress / ghost / n8n).
      // docker_compose_raw must be base64-encoded per Coolify validation.
      name:               NAME,
      project_uuid:       project.uuid,
      server_uuid:        server.uuid,
      environment_name:   ENV_NAME,
      docker_compose_raw: composeYamlB64,
    }),
  })

  const newUuid = created?.uuid ?? created?.data?.uuid ?? created?.service?.uuid
  if (!newUuid) {
    console.warn(`Service created but response shape unknown — full response: ${JSON.stringify(created).slice(0, 400)}`)
  } else {
    console.log(`✓ Service created: ${NAME} (uuid: ${newUuid})`)
  }

  if (DOPPLER_SECRET_NAME && DOPPLER_TOKEN_VALUE && newUuid) {
    console.log(`→ Setting DOPPLER_TOKEN on ${NAME}…`)
    try {
      await api(`/services/${newUuid}/envs`, {
        method: 'POST',
        body:   JSON.stringify({
          key:        'DOPPLER_TOKEN',
          value:      DOPPLER_TOKEN_VALUE,
          is_preview: false,
        }),
      })
      console.log(`✓ DOPPLER_TOKEN set.`)
    } catch (err) {
      console.error(`! Failed to set DOPPLER_TOKEN: ${err.message}`)
      console.error(`  Set it manually in Coolify → ${NAME} → Environment Variables.`)
    }
  }

  if (ALSO_DEPLOY && newUuid) {
    console.log(`→ Triggering initial deploy…`)
    try {
      await api(`/services/${newUuid}/start`, { method: 'POST' })
      console.log(`✓ Deploy triggered. Watch logs in Coolify → ${NAME} → Logs.`)
    } catch (err) {
      console.error(`! Failed to start deploy: ${err.message}`)
      console.error(`  Trigger manually via Coolify → ${NAME} → Deploy.`)
    }
  }

  console.log(`\nDone. Next:`)
  console.log(`  1. Verify in Coolify: ${COOLIFY_URL}/project/${project.uuid}/${ENV_NAME}/service/${newUuid ?? '<uuid>'}`)
  if (!ALSO_DEPLOY) console.log(`  2. Deploy: rerun with --deploy, or click Deploy in Coolify.`)
  console.log(`  3. Wire Cloudflare Tunnel ingress (if public access needed):`)
  console.log(`     doppler run -- node scripts/cloudflare-tunnel-add-hostname.mjs \\`)
  console.log(`       --hostname=${NAME}.<your-tunnel-domain> --service=http://${NAME}:<port> --apply`)
}

main().catch(e => {
  console.error(`\n✗ ${e.message}`)
  process.exit(1)
})
