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

const args            = process.argv.slice(2)
const DRY_RUN         = args.includes('--dry-run')
const APPLY           = args.includes('--apply')
const DELETE          = args.includes('--delete')
// v7: when set with --apply (or --dry-run), existing entries whose URL or
// schedule has DRIFTED are PATCHed in place rather than skipped. Useful
// after CRON_SECRET rotation or schedule changes.
const UPDATE_EXISTING = args.includes('--update-existing')

if (![DRY_RUN, APPLY, DELETE].some(Boolean)) {
  console.error('Usage: doppler run -- node scripts/sync-crons-hmem.mjs <--dry-run|--apply|--delete> [--update-existing]')
  console.error('  --update-existing  also reconcile URL + schedule for already-registered jobs (PATCH cron-job.org).')
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
  // Title MUST start with "Nexus: hmem" so listExistingH() manages it (dedup +
  // update) — otherwise every --apply re-creates it as a duplicate. It writes
  // structural edges into mol_edge (an H-Mem table), so the prefix is apt.
  { title: 'Nexus: hmem-ecosystem-index',          path: '/api/cron/ecosystem-index',          schedule: { minutes: [45], hours: [4],  mdays: [-1], months: [-1], wdays: [-1] } },
  // v7: every 15 min — keeps cron-job.org's own auto-disable from being
  // the first signal of a red cron. The route Slack-pings only on
  // titles-changed or 4h-reminder so this isn't noisy. Title is intentionally
  // "Nexus: " (not "Nexus: hmem...") because the cron isn't an H-Mem cron,
  // but the listExistingH() title filter still picks it up via the broader
  // /cron-health dashboard (which scans for any "Nexus: " prefix).
  { title: 'Nexus: hmem-cron-health-alert',        path: '/api/cron/cron-health-alert',        schedule: { minutes: [0, 15, 30, 45], hours: [-1], mdays: [-1], months: [-1], wdays: [-1] } },
  // v10: watches the alerter itself. Every 6h. If cron_alerts_state hasn't
  // been touched in 4h (= alerter missed two cycles), Slack-pings the
  // operator directly. Second line of defence behind the alerter.
  { title: 'Nexus: hmem-alerter-self-check',       path: '/api/cron/cron-alerter-self-check',  schedule: { minutes: [0], hours: [0, 6, 12, 18], mdays: [-1], months: [-1], wdays: [-1] } },
  // v11: weekly bench of memory-hq vs GBrain. No-ops when GBRAIN_BASE_URL
  // is unset so the cron is safe to register even before GBrain is deployed.
  // Sunday 05:00 UTC — runs after the weekly hmem-consolidate (Sun 03:30)
  // so the bench sees the latest summary nodes.
  { title: 'Nexus: hmem-gbrain-bench',             path: '/api/cron/gbrain-bench',             schedule: { minutes: [0], hours: [5], mdays: [-1], months: [-1], wdays: [0] } },
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

/** Compare an existing cron-job.org job row to the spec we'd register.
 *  Returns the SHALLOW diff between expected + actual; empty array = no drift. */
function diffJobToSpec(job, spec) {
  const expectedUrl = urlFor(spec.path)
  const drift = []
  // cron-job.org normalises URLs; compare encoded forms.
  if ((job.url ?? '') !== expectedUrl) drift.push('url')
  // Schedule fields are arrays — JSON-stringify both sides for shallow compare.
  for (const field of ['minutes', 'hours', 'mdays', 'months', 'wdays']) {
    const a = JSON.stringify(spec.schedule[field] ?? [])
    const b = JSON.stringify(job.schedule?.[field] ?? [])
    if (a !== b) drift.push(`schedule.${field}`)
  }
  if (job.enabled === false) drift.push('disabled')  // re-enable on update
  return drift
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
  const byTitle = new Map(existing.map(j => [j.title, j]))
  console.log(`Found ${existing.length} existing H-Mem cron entries.`)

  for (const spec of SPECS) {
    const match = byTitle.get(spec.title)
    if (match) {
      // Already-registered path — either skip (default) OR reconcile.
      if (!UPDATE_EXISTING) {
        console.log(`✓ already registered: ${spec.title}`)
        continue
      }
      const drift = diffJobToSpec(match, spec)
      if (drift.length === 0) {
        console.log(`✓ already in sync:    ${spec.title}`)
        continue
      }
      if (DRY_RUN) {
        console.log(`~ would update:       ${spec.title} (drift: ${drift.join(', ')})`)
        continue
      }
      process.stdout.write(`~ updating:           ${spec.title} (drift: ${drift.join(', ')})… `)
      // cron-job.org's PATCH replaces the whole `job` object; we use the
      // same payload as create + the existing jobId in the URL.
      await api('PATCH', `/jobs/${match.jobId}`, payloadFor(spec))
      console.log('OK')
      await sleep(1500)
      continue
    }
    // New entry path.
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
