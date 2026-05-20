#!/usr/bin/env node
/**
 * migrate-crons-to-cronjob-org.mjs — one-shot bulk-creates the cron jobs
 * declared in vercel.json on cron-job.org via their REST API.
 *
 * Run via Doppler so the API keys + secrets are injected:
 *
 *   doppler run -- node scripts/migrate-crons-to-cronjob-org.mjs --dry-run
 *   doppler run -- node scripts/migrate-crons-to-cronjob-org.mjs --apply
 *   doppler run -- node scripts/migrate-crons-to-cronjob-org.mjs --list
 *   doppler run -- node scripts/migrate-crons-to-cronjob-org.mjs --delete-nexus
 *
 * Required env (Doppler):
 *   CRONJOB_ORG_API_KEY   API key from cron-job.org → Account → API
 *   CRON_SECRET           same secret /api/cron/* routes validate via
 *                          `Authorization: Bearer ...`
 *   NEXUS_BASE_URL        production URL (e.g. https://nexus.coolifycloudtunnel.uk)
 *
 * Behaviour:
 *   --dry-run    print what would be created, no API writes
 *   --apply      create each job; idempotent — checks for existing by title prefix
 *   --list       fetch and print all jobs currently on the account
 *   --delete-nexus  remove every job whose title starts with "Nexus: "
 *                   (cleanup helper — use to start from a clean state)
 *
 * Job titles are `Nexus: <path-slug>` — used for idempotency + dedupe.
 *
 * Exit codes:
 *   0 — all jobs in expected state
 *   1 — bad CLI usage
 *   2 — missing env
 *   3 — one or more API calls failed
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

const API_KEY     = process.env.CRONJOB_ORG_API_KEY
const CRON_SECRET = process.env.CRON_SECRET
const BASE_URL    = (process.env.NEXUS_BASE_URL ?? '').replace(/\/$/, '')
const API_HOST    = 'https://api.cron-job.org'

const args        = process.argv.slice(2)
const DRY_RUN     = args.includes('--dry-run')
const APPLY       = args.includes('--apply')
const LIST        = args.includes('--list')
const DELETE_ALL  = args.includes('--delete-nexus')

if (![DRY_RUN, APPLY, LIST, DELETE_ALL].some(Boolean)) {
  console.error('Usage: doppler run -- node scripts/migrate-crons-to-cronjob-org.mjs <--dry-run|--apply|--list|--delete-nexus>')
  process.exit(1)
}

if (!API_KEY) { console.error('CRONJOB_ORG_API_KEY not set in Doppler'); process.exit(2) }
if (APPLY && !CRON_SECRET) { console.error('CRON_SECRET not set in Doppler'); process.exit(2) }
if (APPLY && !BASE_URL)    { console.error('NEXUS_BASE_URL not set in Doppler'); process.exit(2) }

// ── Cron-expression → cron-job.org schedule converter ────────────────────────
// cron-job.org wants arrays per field. -1 = any/all. */N expands to [0, N, 2N, ...].
function parseField(expr, max) {
  if (expr === '*') return [-1]
  if (expr.startsWith('*/')) {
    const step = parseInt(expr.slice(2), 10)
    const out = []
    for (let i = 0; i <= max; i += step) out.push(i)
    return out
  }
  if (expr.includes(',')) return expr.split(',').map(s => parseInt(s, 10))
  if (expr.includes('-')) {
    const [a, b] = expr.split('-').map(s => parseInt(s, 10))
    return Array.from({ length: b - a + 1 }, (_, i) => a + i)
  }
  return [parseInt(expr, 10)]
}

function cronToSchedule(cron) {
  const [m, h, mday, mon, wday] = cron.trim().split(/\s+/)
  return {
    timezone: 'UTC',
    minutes:  parseField(m,    59),
    hours:    parseField(h,    23),
    mdays:    parseField(mday, 31),
    months:   parseField(mon,  12),
    wdays:    parseField(wday, 6),
  }
}

function titleFor(cronPath) {
  // /api/cron/foo-bar  →  Nexus: foo-bar
  // /api/cron/foo?x=1  →  Nexus: foo (?x=1)
  const m = cronPath.match(/^\/api\/cron\/([^?]+)(\?.*)?$/)
  if (!m) return `Nexus: ${cronPath}`
  return m[2] ? `Nexus: ${m[1]} (${m[2]})` : `Nexus: ${m[1]}`
}

// ── cron-job.org API client ──────────────────────────────────────────────────
//
// Rate-limit handling:
// cron-job.org's REST API rate-limits writes (PUT/PATCH/DELETE) per key —
// in practice a burst of ~3 PUTs lands fine, the 4th gets a 429. Their docs
// don't publish exact numbers, but ~1 req/sec sustained works.
// On 429 we read `Retry-After` (seconds) when present and otherwise back off
// exponentially: 3s, 5s, 8s. Up to 3 attempts.
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function api(method, path, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API_HOST}${path}`, {
      method,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body:   body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    })
    const text = await res.text()
    let data
    try { data = text ? JSON.parse(text) : null } catch { data = { raw: text.slice(0, 300) } }

    if (res.status === 429 && attempt < 3) {
      const ra = parseInt(res.headers.get('retry-after') || '', 10)
      const waitMs = (Number.isFinite(ra) && ra > 0 ? ra : (3 + attempt * 2)) * 1000
      console.log(`  · 429 from ${method} ${path} — sleeping ${waitMs}ms then retrying (attempt ${attempt + 1}/3)`)
      await sleep(waitMs)
      continue
    }

    if (!res.ok) {
      const err = new Error(`cronjob.org ${method} ${path} → ${res.status}`)
      err.status = res.status
      err.body   = data
      throw err
    }
    return data
  }
  // Should be unreachable — the loop either returns on 2xx or throws on non-429 error.
  // Falling out means 3 consecutive 429s; surface a clear error.
  const err = new Error(`cronjob.org ${method} ${path} → 429 (after 3 retries)`)
  err.status = 429
  throw err
}

async function listJobs() {
  const data = await api('GET', '/jobs')
  return data?.jobs ?? []
}

// ── Build job specs from vercel.json ─────────────────────────────────────────
async function buildSpecs() {
  const raw = await fs.readFile(path.join(REPO_ROOT, 'vercel.json'), 'utf8')
  const vercel = JSON.parse(raw)
  const crons = vercel.crons ?? []
  return crons.map(c => ({
    title:   titleFor(c.path),
    url:     `${BASE_URL}${c.path}`,
    cron:    c.schedule,
    sched:   cronToSchedule(c.schedule),
  }))
}

function specToPayload(spec) {
  return {
    job: {
      url:           spec.url,
      enabled:       true,
      title:         spec.title,
      saveResponses: true,
      schedule:      spec.sched,
      requestMethod: 0, // 0 = GET
      extendedData: {
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      },
      notification: { onFailure: true, onSuccess: false, onDisable: true },
    },
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (LIST) {
    const jobs = await listJobs()
    console.log(`${jobs.length} job(s) on this cron-job.org account:`)
    for (const j of jobs) {
      const marker = (j.title ?? '').startsWith('Nexus:') ? '★' : ' '
      console.log(`  ${marker} #${j.jobId}  ${j.title}  enabled=${j.enabled}  url=${j.url}`)
    }
    return
  }

  if (DELETE_ALL) {
    const jobs = await listJobs()
    const nexus = jobs.filter(j => (j.title ?? '').startsWith('Nexus:'))
    if (nexus.length === 0) {
      console.log('No Nexus-prefixed jobs to delete.')
      return
    }
    console.log(`Deleting ${nexus.length} Nexus-prefixed job(s):`)
    let failed = 0
    for (const j of nexus) {
      try {
        await api('DELETE', `/jobs/${j.jobId}`)
        console.log(`  ✓ deleted #${j.jobId}  ${j.title}`)
      } catch (err) {
        failed++
        console.log(`  ✗ #${j.jobId}  ${j.title}  err=${err.message}`)
      }
    }
    if (failed > 0) process.exit(3)
    return
  }

  // --dry-run or --apply
  const specs = await buildSpecs()
  console.log(`\n${specs.length} cron job(s) from vercel.json:\n`)
  for (const s of specs) {
    console.log(`  ${s.cron.padEnd(15)} → ${s.url}`)
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] would PUT each of the above to cron-job.org')
    return
  }

  // Idempotency: skip if a job with this title already exists
  const existing = new Map((await listJobs()).map(j => [j.title, j]))
  const results = []
  for (const s of specs) {
    const prev = existing.get(s.title)
    if (prev) {
      console.log(`  · skip  ${s.title}  (already exists as #${prev.jobId})`)
      results.push({ title: s.title, action: 'skipped', jobId: prev.jobId })
      continue
    }
    try {
      const out = await api('PUT', '/jobs', specToPayload(s))
      const id = out?.jobId ?? '?'
      console.log(`  ✓ created  #${id}  ${s.title}`)
      results.push({ title: s.title, action: 'created', jobId: id })
    } catch (err) {
      console.log(`  ✗ failed   ${s.title}  err=${err.message}`)
      if (err.body) console.log(`     body: ${JSON.stringify(err.body).slice(0, 300)}`)
      results.push({ title: s.title, action: 'failed', error: err.message })
    }
    // Pace the next PUT to stay under cron-job.org's per-key write rate.
    // Without this, a 10-job batch trips 429 around the 4th request.
    // The api() retry-on-429 above will recover, but a baseline pace is
    // cheaper than burning retries on every call.
    await sleep(1500)
  }

  console.log('\n── summary ──')
  console.log(`  created: ${results.filter(r => r.action === 'created').length}`)
  console.log(`  skipped: ${results.filter(r => r.action === 'skipped').length}`)
  console.log(`  failed:  ${results.filter(r => r.action === 'failed').length}`)
  if (results.some(r => r.action === 'failed')) process.exit(3)
}

main().catch(err => { console.error(err); process.exit(3) })
