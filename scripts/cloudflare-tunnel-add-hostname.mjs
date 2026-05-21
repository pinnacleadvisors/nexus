#!/usr/bin/env node
/**
 * cloudflare-tunnel-add-hostname.mjs — add a public hostname to a
 * Cloudflare-managed tunnel + ensure the matching DNS CNAME exists.
 *
 * Coolify-managed cloudflared sidecars on KVM4 have no local config.yml
 * (verified 2026-05-21 — `docker inspect` shows zero mounts). Tunnel
 * ingress is fully managed via Cloudflare's API. This script wraps the
 * 4-step API dance:
 *   1. Discover the account + zone + tunnel that hosts coolifycloudtunnel.uk
 *   2. Fetch the tunnel's current ingress config
 *   3. Insert the new hostname BEFORE the catch-all (idempotent — skips
 *      if the hostname already maps to the same service)
 *   4. PUT the updated config + create the CNAME DNS record if missing
 *
 * Usage:
 *   doppler run -- node scripts/cloudflare-tunnel-add-hostname.mjs \
 *     --hostname=n8n.coolifycloudtunnel.uk \
 *     --service=http://n8n:5678 \
 *     --dry-run
 *
 *   doppler run -- node scripts/cloudflare-tunnel-add-hostname.mjs \
 *     --hostname=n8n.coolifycloudtunnel.uk \
 *     --service=http://n8n:5678 \
 *     --apply
 *
 * Required env (sourced from Doppler):
 *   CLOUDFLARE_NEXUS_COOLIFY_MIGRATION   API token (any name with cfut_
 *                                          prefix works — pass via
 *                                          CLOUDFLARE_API_TOKEN to override)
 */

const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN
  ?? process.env.CLOUDFLARE_NEXUS_COOLIFY_MIGRATION
const args = process.argv.slice(2)

function arg(name) {
  const a = args.find(x => x.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : null
}

const HOSTNAME = arg('hostname')
const SERVICE  = arg('service')
const DRY_RUN  = args.includes('--dry-run')
const APPLY    = args.includes('--apply')

if (!CF_TOKEN) {
  console.error('Missing CLOUDFLARE_NEXUS_COOLIFY_MIGRATION (or CLOUDFLARE_API_TOKEN). Run via `doppler run --`.')
  process.exit(2)
}
if (!HOSTNAME || !SERVICE) {
  console.error('Usage: --hostname=<fqdn> --service=<url> [--dry-run | --apply]')
  process.exit(2)
}
if (!DRY_RUN && !APPLY) {
  console.error('Must pass --dry-run or --apply.')
  process.exit(2)
}

async function cf(path, opts = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${CF_TOKEN}`,
      'Content-Type':  'application/json',
      ...(opts.headers ?? {}),
    },
  })
  let json
  try { json = await res.json() } catch {
    throw new Error(`CF API ${path}: HTTP ${res.status}, non-JSON body`)
  }
  if (!json.success) {
    const msg = (json.errors ?? []).map(e => `${e.code}: ${e.message}`).join('; ')
    throw new Error(`CF API ${path} → ${msg || `HTTP ${res.status}`}`)
  }
  return json.result
}

function rootDomain(fqdn) {
  // coolifycloudtunnel.uk has a 2-label public suffix; for `.uk` that's
  // fine, for `.co.uk` we'd need PSL. Acceptable for our use case.
  const parts = fqdn.split('.')
  return parts.slice(-2).join('.')
}

async function main() {
  // Account discovery via the zone — most Cloudflare API tokens scoped to
  // specific resources can't list /accounts (returns empty) but CAN read
  // /zones?name=<domain>. The zone payload includes its owning account, so
  // we lift the account_id from there.
  console.log(`→ Locating zone for ${rootDomain(HOSTNAME)}…`)
  const zones = await cf(`/zones?name=${rootDomain(HOSTNAME)}`)
  if (!zones.length) throw new Error(`No zone matches ${rootDomain(HOSTNAME)} visible to this token`)
  const zone = zones[0]
  const accountId = zone.account?.id
  if (!accountId) throw new Error(`Zone payload missing accountId — token may lack Zone:Read scope`)
  console.log(`  Zone:    ${zone.name} (${zone.id})`)
  console.log(`  Account: ${zone.account?.name ?? '(name hidden)'} (${accountId})`)

  console.log(`→ Finding the tunnel that hosts other ${zone.name} subdomains…`)
  const tunnels = await cf(`/accounts/${accountId}/cfd_tunnel?is_deleted=false`)
  let targetTunnel = null
  let targetIngress = []
  for (const t of tunnels) {
    if (t.deleted_at) continue
    try {
      const cfg = await cf(`/accounts/${accountId}/cfd_tunnel/${t.id}/configurations`)
      const ingress = cfg?.config?.ingress ?? []
      if (ingress.some(e => e.hostname?.endsWith(zone.name))) {
        targetTunnel  = t
        targetIngress = ingress
        break
      }
    } catch (e) {
      console.warn(`  (skipped tunnel ${t.id}: ${e.message})`)
    }
  }
  if (!targetTunnel) {
    throw new Error(`No tunnel in this account has ingress for *.${zone.name}. Create one first via the dashboard.`)
  }
  console.log(`  Tunnel: ${targetTunnel.name} (${targetTunnel.id})`)
  console.log(`  Existing ingress entries: ${targetIngress.length}`)
  for (const e of targetIngress) {
    console.log(`    - ${e.hostname ?? '(catch-all)'}  →  ${e.service ?? '?'}`)
  }

  const existing = targetIngress.find(e => e.hostname === HOSTNAME)
  let updatedIngress
  if (existing) {
    if (existing.service === SERVICE) {
      console.log(`✓ Hostname ${HOSTNAME} already maps to ${SERVICE} — no ingress change needed.`)
      updatedIngress = targetIngress
    } else {
      console.log(`! Hostname ${HOSTNAME} exists but points at ${existing.service}; will rewrite to ${SERVICE}.`)
      updatedIngress = targetIngress.map(e =>
        e.hostname === HOSTNAME ? { ...e, service: SERVICE } : e,
      )
    }
  } else {
    const nonCatchAll = targetIngress.filter(e => e.hostname)
    const catchAll    = targetIngress.find(e => !e.hostname)
      ?? { service: 'http_status:404' }
    updatedIngress = [
      ...nonCatchAll,
      { hostname: HOSTNAME, service: SERVICE },
      catchAll,
    ]
    console.log(`+ Will INSERT { ${HOSTNAME} → ${SERVICE} } before the catch-all.`)
  }

  if (APPLY && (!existing || existing.service !== SERVICE)) {
    console.log(`→ PUT tunnel config…`)
    await cf(`/accounts/${accountId}/cfd_tunnel/${targetTunnel.id}/configurations`, {
      method: 'PUT',
      body:   JSON.stringify({ config: { ingress: updatedIngress } }),
    })
    console.log(`✓ Tunnel ingress updated.`)
  } else if (DRY_RUN) {
    console.log(`[DRY-RUN] Ingress update skipped.`)
  }

  // DNS record
  console.log(`→ Checking DNS for ${HOSTNAME}…`)
  const expectedTarget = `${targetTunnel.id}.cfargotunnel.com`
  const dnsRecords = await cf(`/zones/${zone.id}/dns_records?name=${HOSTNAME}`)
  const dnsExisting = dnsRecords.find(r => r.name === HOSTNAME)
  if (dnsExisting && dnsExisting.content === expectedTarget) {
    console.log(`✓ DNS record already correct: ${HOSTNAME} CNAME → ${expectedTarget}`)
  } else if (dnsExisting) {
    console.warn(`! DNS record exists but points at ${dnsExisting.content} (expected ${expectedTarget}).`)
    if (APPLY) {
      console.log(`→ PATCH DNS record…`)
      await cf(`/zones/${zone.id}/dns_records/${dnsExisting.id}`, {
        method: 'PATCH',
        body:   JSON.stringify({ content: expectedTarget, proxied: true }),
      })
      console.log(`✓ DNS record updated.`)
    }
  } else {
    const subdomain = HOSTNAME.replace(`.${zone.name}`, '')
    if (APPLY) {
      console.log(`→ POST DNS record: ${subdomain}.${zone.name} CNAME → ${expectedTarget}`)
      await cf(`/zones/${zone.id}/dns_records`, {
        method: 'POST',
        body:   JSON.stringify({
          type:    'CNAME',
          name:    subdomain,
          content: expectedTarget,
          proxied: true,
          ttl:     1,                // 1 = "Auto" for proxied records
          comment: `n8n migration from KVM1 ${new Date().toISOString().slice(0,10)}`,
        }),
      })
      console.log(`✓ DNS record created.`)
    } else {
      console.log(`[DRY-RUN] Would create CNAME ${subdomain}.${zone.name} → ${expectedTarget}`)
    }
  }

  console.log(`\nDone. Verify in ~30s:`)
  console.log(`  dig +short ${HOSTNAME}`)
  console.log(`  curl -I https://${HOSTNAME}/healthz`)
}

main().catch(e => {
  console.error(`\n✗ ${e.message}`)
  process.exit(1)
})
