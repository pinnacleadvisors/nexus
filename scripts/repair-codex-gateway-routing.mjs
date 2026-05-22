#!/usr/bin/env node
/**
 * scripts/repair-codex-gateway-routing.mjs
 *
 * Two-step repair for the codex-gateway 502 incident class — most often hit
 * after a KVM2 → KVM4 migration left stale routing behind:
 *
 *   1. Doppler `COOLIFY_KVM4_CODEX_UUID` is wrong (Coolify 404s on it).
 *      Auto-discovers the correct UUID by listing KVM4 apps + name-matching.
 *   2. Cloudflare Tunnel ingress for `codex-gw.<your-domain>` is pointing at
 *      a stale tunnel ID (the old KVM2 cloudflared). Lists the current ingress
 *      AND identifies the right KVM4 tunnel to use.
 *
 * Run with --dry-run by default (prints the fixes). Pass --apply to actually
 * update both Doppler AND the Cloudflare tunnel config.
 *
 * Required env (via Doppler):
 *   COOLIFY_KVM4_URL                    Coolify API host
 *   COOLIFY_KVM4_API_TOKEN              Coolify API token
 *   CLOUDFLARE_API_TOKEN                CF token with Account:CF Tunnel:Edit + Zone:DNS:Edit
 *   DOPPLER_TOKEN                       Set automatically by `doppler run --`
 *
 * Optional env:
 *   CODEX_GATEWAY_URL                   default `https://codex-gw.coolifycloudtunnel.uk`
 *   CODEX_GATEWAY_APP_NAME              default `codex-gateway` (the Coolify app name to match)
 *   CODEX_GATEWAY_TARGET_SERVICE        default `http://codex-gateway:3000` (the ingress destination)
 *
 * Usage:
 *   doppler run -- node scripts/repair-codex-gateway-routing.mjs --dry-run
 *   doppler run -- node scripts/repair-codex-gateway-routing.mjs --apply
 */

const RED   = '\x1b[31m'
const GREEN = '\x1b[32m'
const YEL   = '\x1b[33m'
const CYAN  = '\x1b[36m'
const DIM   = '\x1b[2m'
const RST   = '\x1b[0m'

const args = process.argv.slice(2)
const DRY  = args.includes('--dry-run') || !args.includes('--apply')

function section(t)   { console.log(`\n${CYAN}== ${t} ==${RST}`) }
function ok(m)        { console.log(`${GREEN}✓${RST} ${m}`) }
function warn(m)      { console.log(`${YEL}!${RST} ${m}`) }
function fail(m)      { console.log(`${RED}✗${RST} ${m}`) }
function info(m)      { console.log(`  ${m}`) }
function dim(m)       { console.log(`${DIM}  ${m}${RST}`) }

const COOLIFY_URL   = (process.env.COOLIFY_KVM4_URL ?? '').replace(/\/$/, '')
const COOLIFY_TOKEN = process.env.COOLIFY_KVM4_API_TOKEN ?? ''
const CF_TOKEN      = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_NEXUS_COOLIFY_MIGRATION ?? ''
const GW_URL        = (process.env.CODEX_GATEWAY_URL ?? 'https://codex-gw.coolifycloudtunnel.uk').replace(/\/$/, '')
const APP_NAME      = process.env.CODEX_GATEWAY_APP_NAME ?? 'codex-gateway'
const TARGET_SVC    = process.env.CODEX_GATEWAY_TARGET_SERVICE ?? 'http://codex-gateway:3000'

const missing = []
if (!COOLIFY_URL)   missing.push('COOLIFY_KVM4_URL')
if (!COOLIFY_TOKEN) missing.push('COOLIFY_KVM4_API_TOKEN')
if (!CF_TOKEN)      missing.push('CLOUDFLARE_API_TOKEN')
if (missing.length) {
  fail('Missing env vars (run via `doppler run -- ...`):')
  for (const m of missing) info(`  - ${m}`)
  process.exit(2)
}

const HOST = new URL(GW_URL).hostname            // e.g. codex-gw.coolifycloudtunnel.uk

// ── Coolify helpers ─────────────────────────────────────────────────────────

async function coolify(path, opts = {}) {
  const res = await fetch(`${COOLIFY_URL}/api/v1${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${COOLIFY_TOKEN}`, Accept: 'application/json', ...(opts.headers ?? {}) },
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* */ }
  return { ok: res.ok, status: res.status, json, text }
}

// ── Cloudflare helpers ──────────────────────────────────────────────────────

async function cf(path, opts = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  })
  let json
  try { json = await res.json() } catch { throw new Error(`CF API ${path}: HTTP ${res.status}, non-JSON body`) }
  if (!json.success) {
    const msg = (json.errors ?? []).map(e => `${e.code}: ${e.message}`).join('; ')
    throw new Error(`CF API ${path} → ${msg || `HTTP ${res.status}`}`)
  }
  return json.result
}

function rootDomain(fqdn) {
  // Handle public-suffix-2-label cases (.uk, .co.uk, .com.au, ...). Same
  // approach as scripts/cloudflare-tunnel-add-hostname.mjs.
  const parts = fqdn.split('.')
  if (parts.length <= 2) return fqdn
  const secondLevel = parts[parts.length - 2]
  const last        = parts[parts.length - 1]
  if (['co','com','net','org','gov','ac'].includes(secondLevel) && last.length === 2) {
    return parts.slice(-3).join('.')
  }
  return parts.slice(-2).join('.')
}

// ── 1. Discover correct codex-gateway UUID on Coolify ───────────────────────

section('1. Coolify — discover correct codex-gateway UUID on KVM4')

const listRes = await coolify('/applications')
if (!listRes.ok) {
  fail(`could not list Coolify applications: ${listRes.status} ${listRes.text.slice(0, 120)}`)
  process.exit(1)
}
const apps = Array.isArray(listRes.json) ? listRes.json : (listRes.json?.data ?? [])
info(`Coolify reports ${apps.length} application(s) on KVM4`)

const matches = apps.filter(a => (a.name ?? '').toLowerCase().includes(APP_NAME.toLowerCase()))
if (matches.length === 0) {
  fail(`No Coolify application matching name "${APP_NAME}" on KVM4. Has codex-gateway actually been redeployed on KVM4?`)
  info('You may need to: SSH KVM4 → Coolify UI → New Resource → Docker Compose → import services/codex-gateway/docker-compose.yaml')
  process.exit(1)
}

const newUuid = matches[0].uuid
const stateStr = matches[0].status ?? 'unknown'
const fqdnStr  = matches[0].fqdn   ?? '(none)'

if (matches.length > 1) {
  warn(`Multiple matches for "${APP_NAME}":`)
  for (const m of matches) info(`    - ${m.name} (uuid=${m.uuid}, status=${m.status ?? '?'})`)
  warn(`Picking the first match: ${matches[0].name} → ${newUuid}`)
} else {
  ok(`Found codex-gateway on KVM4:`)
  info(`name:   ${matches[0].name}`)
  info(`uuid:   ${newUuid}`)
  info(`status: ${stateStr}`)
  info(`fqdn:   ${fqdnStr}`)
}

const currentDopplerUuid = process.env.COOLIFY_KVM4_CODEX_UUID ?? '(unset)'
if (currentDopplerUuid === newUuid) {
  ok(`Doppler COOLIFY_KVM4_CODEX_UUID already matches (${newUuid}). No change needed.`)
} else {
  warn(`Doppler COOLIFY_KVM4_CODEX_UUID = "${currentDopplerUuid}" — needs update to "${newUuid}"`)
  if (DRY) {
    console.log(`\n${YEL}Run this to update Doppler:${RST}`)
    console.log(`  doppler secrets set COOLIFY_KVM4_CODEX_UUID="${newUuid}" --project nexus --config prd --no-interactive`)
  } else {
    info('Applying Doppler update via `doppler secrets set`…')
    const { spawnSync } = await import('node:child_process')
    const res = spawnSync('doppler', [
      'secrets', 'set', `COOLIFY_KVM4_CODEX_UUID=${newUuid}`,
      '--project',  'nexus',
      '--config',   'prd',
      '--no-interactive',
    ], { stdio: 'inherit' })
    if (res.status === 0) ok('Doppler updated.')
    else fail(`doppler set exited with code ${res.status}`)
  }
}

// ── 2. Discover Cloudflare account, zone, tunnel for codex-gw.<domain> ─────

section('2. Cloudflare — discover correct tunnel hosting codex-gw.<domain>')

const zoneName = rootDomain(HOST)
info(`Target hostname: ${HOST} (root domain: ${zoneName})`)

const zones = await cf(`/zones?name=${encodeURIComponent(zoneName)}`)
if (zones.length === 0) {
  fail(`Cloudflare returned no zone for ${zoneName} — check the API token has Zone:Zone:Read for this zone.`)
  process.exit(1)
}
const zone = zones[0]
ok(`zone: ${zone.name} (id=${zone.id.slice(0, 8)}…, account=${zone.account.name})`)

const accountId = zone.account.id
const tunnels   = await cf(`/accounts/${accountId}/cfd_tunnel?is_deleted=false`)
info(`Account has ${tunnels.length} active tunnel(s)`)

// Walk each tunnel's ingress to find the one already routing HOST. Prefer
// that one (its other hostnames probably already work). If none match, look
// for a tunnel currently hosting other coolifycloudtunnel.uk subdomains.
let currentTunnel = null
let currentIngressEntry = null
let otherZoneTunnels = []
for (const t of tunnels) {
  let cfg
  try { cfg = await cf(`/accounts/${accountId}/cfd_tunnel/${t.id}/configurations`) } catch { continue }
  const ingress = cfg?.config?.ingress ?? []
  const match = ingress.find(i => i.hostname === HOST)
  if (match) {
    currentTunnel = t
    currentIngressEntry = match
    break
  }
  const hostsSomeZoneSubdomain = ingress.some(i => i.hostname?.endsWith(`.${zoneName}`))
  if (hostsSomeZoneSubdomain) otherZoneTunnels.push({ tunnel: t, cfg })
}

if (currentTunnel) {
  ok(`tunnel currently serving ${HOST}:`)
  info(`name:    ${currentTunnel.name}`)
  info(`id:      ${currentTunnel.id.slice(0, 8)}…`)
  info(`service: ${currentIngressEntry.service}`)
  if (currentIngressEntry.service === TARGET_SVC) {
    ok(`ingress service already correct (${TARGET_SVC}). The 502 is elsewhere — likely the codex-gateway container itself isn't running on the network that cloudflared can resolve. Check Coolify Resources for codex-gateway state.`)
  } else {
    warn(`ingress service mismatch:`)
    info(`  current: ${currentIngressEntry.service}`)
    info(`  desired: ${TARGET_SVC}`)
    if (DRY) {
      console.log(`\n${YEL}Run with --apply to update the tunnel ingress:${RST}`)
      console.log(`  doppler run -- node scripts/repair-codex-gateway-routing.mjs --apply`)
    } else {
      info('Applying tunnel ingress update…')
      // Re-fetch current config, mutate the matching entry's service, PUT it back.
      const cfg = await cf(`/accounts/${accountId}/cfd_tunnel/${currentTunnel.id}/configurations`)
      const ingress = cfg.config?.ingress ?? []
      const idx = ingress.findIndex(i => i.hostname === HOST)
      if (idx === -1) { fail('Lost track of ingress entry between read and write — re-run.'); process.exit(1) }
      ingress[idx] = { ...ingress[idx], service: TARGET_SVC }
      await cf(`/accounts/${accountId}/cfd_tunnel/${currentTunnel.id}/configurations`, {
        method: 'PUT',
        body:   JSON.stringify({ config: { ...cfg.config, ingress } }),
      })
      ok(`tunnel ingress updated. New service: ${TARGET_SVC}`)
    }
  }
} else if (otherZoneTunnels.length > 0) {
  // Different tunnel hosts other subdomains of the same zone — that's the
  // one to add HOST to (or to migrate HOST from a different/stale tunnel).
  warn(`No tunnel currently serves ${HOST}, but ${otherZoneTunnels.length} tunnel(s) host other ${zoneName} subdomains:`)
  for (const { tunnel } of otherZoneTunnels) info(`    - ${tunnel.name} (id=${tunnel.id.slice(0, 8)}…)`)
  info(`Recommended: add HOST to the FIRST tunnel via the existing helper:`)
  console.log(`\n${CYAN}  doppler run -- node scripts/cloudflare-tunnel-add-hostname.mjs \\${RST}`)
  console.log(`${CYAN}    --hostname=${HOST} \\${RST}`)
  console.log(`${CYAN}    --service=${TARGET_SVC} \\${RST}`)
  console.log(`${CYAN}    --apply${RST}\n`)
  info(`(Inspect the other ingress in the tunnel(s) above to confirm you want HOST added there — the script appends BEFORE the catch-all.)`)
} else {
  fail(`No Cloudflare tunnel currently serves ${HOST} OR any other ${zoneName} subdomain.`)
  info(`This is a fresh-deploy state. Steps:`)
  info(`  1. Bring up cloudflared on KVM4 and create a new tunnel in Cloudflare Dashboard.`)
  info(`  2. Re-run this script — it will find the new tunnel and update ingress.`)
  info(`  See docs/runbooks/migrate-to-lean-kvm.md.`)
}

// ── 3. DNS sanity-check ─────────────────────────────────────────────────────

section('3. Cloudflare DNS — confirm CNAME for HOST points at cfargotunnel')

try {
  const records = await cf(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(HOST)}&per_page=10`)
  if (records.length === 0) {
    warn(`No DNS record for ${HOST}. After fixing the tunnel ingress, also create a CNAME via cloudflare-tunnel-add-hostname.mjs.`)
  } else {
    for (const r of records) {
      const expected = currentTunnel ? `${currentTunnel.id}.cfargotunnel.com` : '<tunnel>.cfargotunnel.com'
      const matches  = r.type === 'CNAME' && r.content.endsWith('.cfargotunnel.com')
      if (matches) {
        if (currentTunnel && !r.content.startsWith(currentTunnel.id)) {
          warn(`CNAME for ${HOST} points at ${r.content} but current tunnel is ${currentTunnel.id.slice(0, 8)}… — DNS is pointing at a STALE tunnel.`)
          if (DRY) {
            console.log(`\n${YEL}Run with --apply to update DNS to the correct tunnel:${RST}`)
            console.log(`  doppler run -- node scripts/repair-codex-gateway-routing.mjs --apply`)
          } else {
            info(`Updating DNS record ${r.id.slice(0, 8)}… to point at ${currentTunnel.id.slice(0, 8)}.cfargotunnel.com`)
            await cf(`/zones/${zone.id}/dns_records/${r.id}`, {
              method: 'PUT',
              body:   JSON.stringify({ type: 'CNAME', name: HOST, content: `${currentTunnel.id}.cfargotunnel.com`, proxied: true }),
            })
            ok('DNS updated.')
          }
        } else {
          ok(`CNAME ${HOST} → ${r.content} (proxied=${r.proxied}) — points at correct tunnel.`)
        }
      } else {
        warn(`Record ${r.type} ${r.name} → ${r.content} — not a tunnel CNAME, may need cleanup.`)
      }
    }
  }
} catch (err) {
  warn(`DNS lookup failed: ${err.message}`)
}

// ── 4. Final verification ──────────────────────────────────────────────────

section('4. Final verification (skipped in dry-run)')

if (DRY) {
  warn(`Dry-run mode. After running with --apply, re-run \`npm run diagnose:codex\` to confirm the 502 is gone.`)
} else {
  info(`Waiting 5s for Cloudflare config propagation…`)
  await new Promise(r => setTimeout(r, 5_000))
  info(`Probing ${GW_URL}/health …`)
  try {
    const res = await fetch(`${GW_URL}/health`, { signal: AbortSignal.timeout(10_000) })
    if (res.ok) {
      ok(`${GW_URL}/health → 200 — codex pill should work now.`)
      info('Run `npm run diagnose:codex` for the full verdict.')
    } else {
      warn(`${GW_URL}/health → ${res.status}. Cloudflare propagation can take 10–30s. Wait and retry, or re-run \`npm run diagnose:codex\`.`)
    }
  } catch (err) {
    warn(`probe failed: ${err.message}. Wait and retry.`)
  }
}

console.log(`\n${DIM}Done. Run again any time to verify state.${RST}`)
