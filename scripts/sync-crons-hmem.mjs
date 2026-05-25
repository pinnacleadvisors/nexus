#!/usr/bin/env node
/**
 * scripts/sync-crons-hmem.mjs — register the H-Mem crons with cron-job.org.
 *
 * Idempotent. Lists existing jobs first; skips any whose title already
 * matches the expected slug. Use --apply to create; --dry-run to preview;
 * --delete to remove all H-Mem entries (for cleanup).
 *
 * Usage:
 *   doppler run -- node scripts/sync-crons-hmem.mjs --dry-run
 *   doppler run -- node scripts/sync-crons-hmem.mjs --apply
 *   doppler run -- node scripts/sync-crons-hmem.mjs --delete
 *
 * Env:
 *   CRONJOB_ORG_API_KEY — required
 *   CRON_SECRET         — required (passed as ?secret= on the cron URLs)
 *   NEXUS_BASE_URL      — required (e.g. https://nexus.coolifycloudtunnel.uk)
 */

const API_KEY     = process.env.CRONJOB_ORG_API_KEY
const CRON_SECRET = process.env.CRON_SECRET
const BASE_URL    = (process.env.NEXUS_BASE_URL ?? '').replace(/\/$/, '')
const API_HOST    = 'https://api.cron-job.org'

const args     = process.argv.slice(2)
const DRY_RUN  = args.includes('--dry-run')
const APPLY    = args.includes('--apply')
const DELETE   = args.includes('--delete')

if (![DRY_RUN, APPLY, DELETE].some(Boolean)) {
  console.error('Usage: doppler run -- node scripts/sync-crons-hmem.mjs <--dry-run|--apply|--delete>')
  process.exit(1)
}
if (!API_KEY) { console.error('CRONJOB_ORG_API_KEY not set'); process.exit(2) }
if ((APPLY || DRY_RUN) && (!CRON_SECRET || !BASE_URL)) {
  console.error('CRON_SECRET + NEXUS_BASE_URL required when applying / dry-running')
  process.exit(2)
}

/**
 * The 4 H-Mem crons we want registered. Schedules:
 *   hmem-consolidate level=1   daily   03:00 UTC
 *   hmem-consolidate level=2   weekly  Sunday 03:30 UTC
 *   hmem-consolidate level=3   monthly 1st 04:00 UTC
 *   hmem-extract-edges         daily   04:30 UTC
 */
const SPECS = [
  { title: 'Nexus: hmem-consolidate (daily L1)',   path: '/api/cron/hmem-consolidate?level=1', schedule: { minutes: [0],  hours: [3],  mdays: [-1], months: [-1], wdays: [-1] } },
  { title: 'Nexus: hmem-consolidate (weekly L2)',  path: '/api/cron/hmem-consolidate?level=2', schedule: { minutes: [30], hours: [3],  mdays: [-1], months: [-1], wdays: [0]  } },
  { title: 'Nexus: hmem-consolidate (monthly L3)', path: '/api/cron/hmem-consolidate?level=3', schedule: { minutes: [0],  hours: [4],  mdays: [1],  months: [-1], wdays: [-1] } },
  { title: 'Nexus: hmem-extract-edges',            path: '/api/cron/hmem-extract-edges',       schedule: { minutes: [30], hours: [4],  mdays: [-1], months: [-1], wdays: [-1] } },
]

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function api(method, path, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API_HOST}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body:   body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    })
    const text = await res.text()
    let data
    try { data = text ? JSON.parse(text) : null } catch { data = { raw: text.slice(0, 300) } }
    if (res.status === 429 && attempt < 3) {
      const ra = parseInt(res.headers.get('retry-after') || '', 10)
      const waitMs = (Number.isFinite(ra) && ra > 0 ? ra : (3 + attempt * 2)) * 1000
      console.log(`  · 429 — sleeping ${waitMs}ms before retry ${attempt + 1}/3`)
      await sleep(waitMs)
      continue
    }
    if (!res.ok) throw new Error(`cronjob.org ${method} ${path} → ${res.status}: ${JSON.stringify(data)}`)
    return data
  }
  throw new Error(`cronjob.org ${method} ${path} → 429 after retries`)
}

function urlFor(specPath) {
  // append ?secret= or &secret= depending on whether the path already has a query string
  const sep = specPath.includes('?') ? '&' : '?'
  return `${BASE_URL}${specPath}${sep}secret=${encodeURIComponent(CRON_SECRET)}`
}

function payloadFor(spec) {
  return {
    job: {
      url:          urlFor(spec.path),
      enabled:      true,
      saveResponses: true,
      title:        spec.title,
      schedule:     { timezone: 'UTC', ...spec.schedule },
      requestMethod: 1,    // 1 = POST
      requestTimeout: 30,
      // Watch for 5xx as failures (cron-job.org's default treats 4xx as
      // success which we don't want — our crons return 200 on transient
      // failures per the retry-storm rule, so any 5xx is a real bug).
      notification: {
        onFailure: true,
        onSuccess: false,
      },
    },
  }
}

async function listExistingH() {
  const data = await api('GET', '/jobs')
  const jobs = data?.jobs ?? []
  return jobs.filter(j => typeof j.title === 'string' && j.title.startsWith('Nexus: hmem'))
}

async function main() {
  if (DELETE) {
    const existing = await listExistingH()
    console.log(`Found ${existing.length} H-Mem cron entries to delete:`)
    for (const j of existing) {
      console.log(`  · ${j.title} (id=${j.jobId})`)
      await api('DELETE', `/jobs/${j.jobId}`)
      await sleep(1000)
    }
    console.log('Done.')
    return
  }

  const existing = await listExistingH()
  const existingTitles = new Set(existing.map(j => j.title))
  console.log(`Found ${existing.length} existing H-Mem cron entries.`)

  for (const spec of SPECS) {
    if (existingTitles.has(spec.title)) {
      console.log(`✓ already registered: ${spec.title}`)
      continue
    }
    if (DRY_RUN) {
      console.log(`+ would create: ${spec.title}`)
      console.log(`    url: ${urlFor(spec.path).replace(CRON_SECRET, '<redacted>')}`)
      continue
    }
    process.stdout.write(`+ creating: ${spec.title}… `)
    await api('PUT', '/jobs', payloadFor(spec))
    console.log('OK')
    await sleep(1500)  // stay under the write-rate-limit
  }
  console.log('Done.')
}

main().catch(e => { console.error(e); process.exit(1) })
