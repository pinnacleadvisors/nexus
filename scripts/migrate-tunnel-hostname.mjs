#!/usr/bin/env node
/**
 * scripts/migrate-tunnel-hostname.mjs
 *
 * Moves a public hostname between Cloudflare Tunnels — different problem
 * from cloudflare-tunnel-add-hostname.mjs (which ADDS) or
 * repair-codex-gateway-routing.mjs (which UPDATES the existing tunnel's
 * ingress). Use when a service migrates between hosts and the old tunnel's
 * cloudflared can no longer reach the origin.
 *
 * 2026-05-22 use case: codex-gateway migrated KVM2/KVM3 → KVM4. The hostname
 * codex-gw.coolifycloudtunnel.uk was still routed via the old
 * `openclaw_codex_kvm2` tunnel (cloudflared on KVM3). cloudflared on KVM3
 * can't reach codex-gateway:3000 because that container only exists on KVM4
 * now. The fix is to MOVE the hostname to `nexus-fleet` (cloudflared on
 * KVM4) which CAN resolve codex-gateway:3000 on the shared `coolify` network.
 *
 * Operations performed:
 *   1. Discover --to-tunnel by name (case-insensitive substring match).
 *   2. Discover the source tunnel currently serving --hostname (or use
 *      --from-tunnel if specified).
 *   3. Remove the hostname entry from the source tunnel's ingress.
 *   4. Insert the hostname entry into the target tunnel's ingress BEFORE
 *      the catch-all (404/http_status:404). Idempotent — skips if already
 *      present with the same service.
 *   5. Update the DNS CNAME for the hostname to point at the new tunnel's
 *      cfargotunnel.com address.
 *   6. Probe https://<hostname>/health to confirm propagation.
 *
 * Required env (via Doppler):
 *   CLOUDFLARE_API_TOKEN  — Account:CF Tunnel:Edit + Zone:DNS:Edit + Zone:Zone:Read
 *
 * Usage:
 *   doppler run -- node scripts/migrate-tunnel-hostname.mjs \
 *     --hostname=codex-gw.coolifycloudtunnel.uk \
 *     --to-tunnel=nexus-fleet \
 *     --service=http://codex-gateway:3000 \
 *     --dry-run
 *
 *   doppler run -- node scripts/migrate-tunnel-hostname.mjs \
 *     --hostname=codex-gw.coolifycloudtunnel.uk \
 *     --to-tunnel=nexus-fleet \
 *     --service=http://codex-gateway:3000 \
 *     --apply
 *
 * Optional flags:
 *   --from-tunnel=NAME    explicitly name the source tunnel (else auto-detect)
 *   --keep-source         skip removing the entry from the source tunnel
 *                         (use for read-only validation against the target)
 *   --skip-dns            skip the DNS CNAME update (use if DNS already correct)
 */

const RED   = '\x1b[31m'
const GREEN = '\x1b[32m'
const YEL   = '\x1b[33m'
const CYAN  = '\x1b[36m'
const DIM   = '\x1b[2m'
const RST   = '\x1b[0m'

const args = process.argv.slice(2)
function arg(name) {
  const a = args.find(x => x.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : null
}

const HOSTNAME    = arg('hostname')
const TO_TUNNEL   = arg('to-tunnel')
const FROM_TUNNEL = arg('from-tunnel')
const SERVICE     = arg('service')
const DRY_RUN     = args.includes('--dry-run') || !args.includes('--apply')
const KEEP_SOURCE = args.includes('--keep-source')
const SKIP_DNS    = args.includes('--skip-dns')

function section(t) { console.log(`\n${CYAN}== ${t} ==${RST}`) }
function ok(m)      { console.log(`${GREEN}✓${RST} ${m}`) }
function warn(m)    { console.log(`${YEL}!${RST} ${m}`) }
function fail(m)    { console.log(`${RED}✗${RST} ${m}`) }
function info(m)    { console.log(`  ${m}`) }
function dim(m)     { console.log(`${DIM}  ${m}${RST}`) }

const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_NEXUS_COOLIFY_MIGRATION
if (!CF_TOKEN) {
  fail('CLOUDFLARE_API_TOKEN unset. Run via `doppler run -- ...`.')
  process.exit(2)
}
if (!HOSTNAME)   { fail('Missing --hostname=<fqdn>');                  process.exit(2) }
if (!TO_TUNNEL)  { fail('Missing --to-tunnel=<name-substring>');       process.exit(2) }
if (!SERVICE)    { fail('Missing --service=<url> (e.g. http://codex-gateway:3000)'); process.exit(2) }

async function cf(path, opts = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  })
  let json
  try { json = await res.json() } catch { throw new Error(`CF ${path}: HTTP ${res.status}, non-JSON body`) }
  if (!json.success) {
    const msg = (json.errors ?? []).map(e => `${e.code}: ${e.message}`).join('; ')
    throw new Error(`CF ${path} → ${msg || `HTTP ${res.status}`}`)
  }
  return json.result
}

function rootDomain(fqdn) {
  const parts = fqdn.split('.')
  if (parts.length <= 2) return fqdn
  const secondLevel = parts[parts.length - 2]
  const last        = parts[parts.length - 1]
  if (['co','com','net','org','gov','ac'].includes(secondLevel) && last.length === 2) {
    return parts.slice(-3).join('.')
  }
  return parts.slice(-2).join('.')
}

// ── 1. Discover zone + account ──────────────────────────────────────────────

section('1. Discover zone + account')
const zoneName = rootDomain(HOSTNAME)
const zones = await cf(`/zones?name=${encodeURIComponent(zoneName)}`)
if (zones.length === 0) {
  fail(`No Cloudflare zone for ${zoneName}. Token may lack Zone:Zone:Read for this zone.`)
  process.exit(1)
}
const zone = zones[0]
const accountId = zone.account.id
ok(`zone: ${zone.name} · account: ${zone.account.name}`)

// ── 2. Resolve --to-tunnel by name ──────────────────────────────────────────

section(`2. Resolve --to-tunnel (substring match: "${TO_TUNNEL}")`)
const allTunnels = await cf(`/accounts/${accountId}/cfd_tunnel?is_deleted=false`)
const toMatches = allTunnels.filter(t => (t.name ?? '').toLowerCase().includes(TO_TUNNEL.toLowerCase()))
if (toMatches.length === 0) {
  fail(`No active tunnel matches "${TO_TUNNEL}". Active tunnels:`)
  for (const t of allTunnels) info(`  - ${t.name} (id=${t.id.slice(0, 8)}…)`)
  process.exit(1)
}
if (toMatches.length > 1) {
  warn(`Multiple matches for "${TO_TUNNEL}" — picking the first:`)
  for (const t of toMatches) info(`  - ${t.name} (id=${t.id.slice(0, 8)}…)`)
}
const target = toMatches[0]
ok(`target tunnel: ${target.name} (id=${target.id.slice(0, 8)}…)`)

// ── 3. Find the source tunnel currently serving HOSTNAME ────────────────────

section('3. Find source tunnel currently serving the hostname')
let source = null
let sourceCfg = null
let sourceIdx = -1

if (FROM_TUNNEL) {
  const fromMatches = allTunnels.filter(t => (t.name ?? '').toLowerCase().includes(FROM_TUNNEL.toLowerCase()))
  if (fromMatches.length === 0) {
    warn(`--from-tunnel "${FROM_TUNNEL}" matched no active tunnel. Auto-detecting from ingress…`)
  } else {
    source = fromMatches[0]
    try {
      sourceCfg = await cf(`/accounts/${accountId}/cfd_tunnel/${source.id}/configurations`)
      const ingress = sourceCfg.config?.ingress ?? []
      sourceIdx = ingress.findIndex(i => i.hostname === HOSTNAME)
      if (sourceIdx === -1) {
        warn(`${source.name} ingress does NOT currently contain ${HOSTNAME}. Nothing to remove from source.`)
        source = null
      } else {
        ok(`source tunnel (specified): ${source.name} (id=${source.id.slice(0, 8)}…)`)
        info(`current service: ${ingress[sourceIdx].service}`)
      }
    } catch (err) {
      warn(`Could not read ingress for --from-tunnel ${source.name}: ${err.message}`)
      source = null
    }
  }
}

if (!source) {
  for (const t of allTunnels) {
    if (t.id === target.id) continue
    let cfg
    try { cfg = await cf(`/accounts/${accountId}/cfd_tunnel/${t.id}/configurations`) } catch { continue }
    const ingress = cfg?.config?.ingress ?? []
    const idx = ingress.findIndex(i => i.hostname === HOSTNAME)
    if (idx !== -1) {
      source = t
      sourceCfg = cfg
      sourceIdx = idx
      ok(`source tunnel (auto-detected): ${t.name} (id=${t.id.slice(0, 8)}…)`)
      info(`current service: ${ingress[idx].service}`)
      break
    }
  }
}

if (!source) {
  warn(`No source tunnel currently serves ${HOSTNAME}. Target tunnel will be set up fresh.`)
}

if (source && source.id === target.id) {
  warn(`Source and target are the same tunnel (${source.name}). Use repair-codex-gateway-routing.mjs for same-tunnel ingress updates.`)
  process.exit(1)
}

// ── 4. Inspect target tunnel's current ingress ──────────────────────────────

section('4. Inspect target tunnel ingress (will we change it?)')
const targetCfg = await cf(`/accounts/${accountId}/cfd_tunnel/${target.id}/configurations`)
const targetIngress = (targetCfg.config?.ingress ?? []).slice()  // shallow clone for mutation
const existingTargetIdx = targetIngress.findIndex(i => i.hostname === HOSTNAME)

let willAddToTarget   = false
let willUpdateService = false

if (existingTargetIdx === -1) {
  willAddToTarget = true
  ok(`target does NOT yet host ${HOSTNAME} — will insert before catch-all`)
} else if (targetIngress[existingTargetIdx].service !== SERVICE) {
  willUpdateService = true
  ok(`target already hosts ${HOSTNAME} but service differs:`)
  info(`  current: ${targetIngress[existingTargetIdx].service}`)
  info(`  desired: ${SERVICE}`)
} else {
  ok(`target already hosts ${HOSTNAME} → ${SERVICE} (no target-side change needed)`)
}

// Build the proposed target ingress.
const newTargetIngress = targetIngress.slice()
if (willAddToTarget) {
  const entry = { hostname: HOSTNAME, service: SERVICE }
  // Insert just before the catch-all (last entry with no hostname).
  const catchAllIdx = newTargetIngress.findIndex(i => !i.hostname || i.service === 'http_status:404')
  if (catchAllIdx === -1) {
    newTargetIngress.push(entry)
    // Always preserve a catch-all
    newTargetIngress.push({ service: 'http_status:404' })
  } else {
    newTargetIngress.splice(catchAllIdx, 0, entry)
  }
} else if (willUpdateService) {
  newTargetIngress[existingTargetIdx] = { ...newTargetIngress[existingTargetIdx], service: SERVICE }
}

// Build the proposed source ingress (removal).
let newSourceIngress = null
let willRemoveFromSource = false
if (source && !KEEP_SOURCE) {
  newSourceIngress = (sourceCfg.config?.ingress ?? []).slice()
  if (sourceIdx !== -1) {
    newSourceIngress.splice(sourceIdx, 1)
    willRemoveFromSource = true
  }
}

// ── 5. DNS CNAME plan ───────────────────────────────────────────────────────

section('5. DNS CNAME plan')
let dnsRecord = null
let willUpdateDns = false
let willCreateDns = false
const targetCname = `${target.id}.cfargotunnel.com`

if (SKIP_DNS) {
  warn(`--skip-dns set; not touching DNS records.`)
} else {
  const records = await cf(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(HOSTNAME)}&per_page=10`)
  dnsRecord = records.find(r => r.type === 'CNAME') ?? null
  if (!dnsRecord) {
    willCreateDns = true
    ok(`no CNAME for ${HOSTNAME} → will create → ${targetCname}`)
  } else if (dnsRecord.content === targetCname) {
    ok(`CNAME for ${HOSTNAME} already points at ${targetCname}`)
  } else {
    willUpdateDns = true
    ok(`CNAME for ${HOSTNAME} points at ${dnsRecord.content} → will update to ${targetCname}`)
  }
}

// ── 6. Summary + dry-run gate ───────────────────────────────────────────────

section('6. Plan summary')
const planLines = []
if (willRemoveFromSource) planLines.push(`remove ${HOSTNAME} from tunnel ${source.name}`)
if (willAddToTarget)      planLines.push(`add ${HOSTNAME} → ${SERVICE} to tunnel ${target.name}`)
if (willUpdateService)    planLines.push(`update ${HOSTNAME} service on ${target.name} to ${SERVICE}`)
if (willCreateDns)        planLines.push(`create CNAME ${HOSTNAME} → ${targetCname}`)
if (willUpdateDns)        planLines.push(`update CNAME ${HOSTNAME} → ${targetCname}`)
if (planLines.length === 0) {
  ok('Nothing to do — desired state already in place.')
  process.exit(0)
}
info(`Plan (${planLines.length} step${planLines.length === 1 ? '' : 's'}):`)
for (const l of planLines) info(`  - ${l}`)

if (DRY_RUN) {
  console.log(`\n${YEL}Dry-run mode. Re-run with --apply to execute.${RST}`)
  process.exit(0)
}

// ── 7. Apply ────────────────────────────────────────────────────────────────

section('7. Applying changes')

if (willAddToTarget || willUpdateService) {
  info(`PUT target tunnel ${target.name} ingress (${newTargetIngress.length} entries)`)
  await cf(`/accounts/${accountId}/cfd_tunnel/${target.id}/configurations`, {
    method: 'PUT',
    body:   JSON.stringify({ config: { ...targetCfg.config, ingress: newTargetIngress } }),
  })
  ok('target tunnel updated')
}

if (willRemoveFromSource && newSourceIngress) {
  info(`PUT source tunnel ${source.name} ingress (${newSourceIngress.length} entries — removed ${HOSTNAME})`)
  await cf(`/accounts/${accountId}/cfd_tunnel/${source.id}/configurations`, {
    method: 'PUT',
    body:   JSON.stringify({ config: { ...sourceCfg.config, ingress: newSourceIngress } }),
  })
  ok('source tunnel updated')
}

if (willCreateDns) {
  info(`POST CNAME ${HOSTNAME} → ${targetCname}`)
  await cf(`/zones/${zone.id}/dns_records`, {
    method: 'POST',
    body:   JSON.stringify({ type: 'CNAME', name: HOSTNAME, content: targetCname, proxied: true }),
  })
  ok('CNAME created')
} else if (willUpdateDns && dnsRecord) {
  info(`PUT CNAME ${HOSTNAME} → ${targetCname}`)
  await cf(`/zones/${zone.id}/dns_records/${dnsRecord.id}`, {
    method: 'PUT',
    body:   JSON.stringify({ type: 'CNAME', name: HOSTNAME, content: targetCname, proxied: dnsRecord.proxied ?? true }),
  })
  ok('CNAME updated')
}

// ── 8. Probe ────────────────────────────────────────────────────────────────

section('8. Smoke test')
info('Waiting 8s for Cloudflare propagation…')
await new Promise(r => setTimeout(r, 8_000))
try {
  const res = await fetch(`https://${HOSTNAME}/health`, { signal: AbortSignal.timeout(10_000) })
  if (res.ok) {
    ok(`https://${HOSTNAME}/health → 200 — migration succeeded.`)
    const text = await res.text().catch(() => '')
    if (text) dim(text.slice(0, 200))
  } else if (res.status === 502 || res.status === 503) {
    warn(`https://${HOSTNAME}/health → ${res.status}. CF propagation can take 10-30s — retry the smoke test in a moment.`)
  } else {
    warn(`https://${HOSTNAME}/health → ${res.status}. The tunnel routing is correct; the origin returned an error.`)
  }
} catch (err) {
  warn(`probe failed: ${err.message}. Wait and retry.`)
}

console.log(`\n${DIM}Done. Re-run \`npm run diagnose:codex\` to confirm full health.${RST}`)
