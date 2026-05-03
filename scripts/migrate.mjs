#!/usr/bin/env node
/**
 * Nexus — Supabase migration runner
 *
 * Applies all pending SQL files in supabase/migrations/ to your Supabase project
 * using the Supabase Management API. Applied migrations are recorded in the
 * `schema_migrations` table so they are never run twice.
 *
 * Usage:
 *   npm run migrate              # uses Doppler for secrets
 *   node scripts/migrate.mjs    # uses shell env vars directly
 *
 * Required env vars (set in Doppler):
 *   SUPABASE_PROJECT_REF    Project reference ID — Project Settings → General → Reference ID
 *   SUPABASE_ACCESS_TOKEN   Personal access token — supabase.com/account/tokens → New token
 */

import { readdir, readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations')
const MGMT_API = 'https://api.supabase.com'

// ── Validate required env vars ────────────────────────────────────────────────
const PROJECT_REF   = process.env.SUPABASE_PROJECT_REF
const ACCESS_TOKEN  = process.env.SUPABASE_ACCESS_TOKEN

if (!PROJECT_REF || !ACCESS_TOKEN) {
  console.error('\n❌  Missing environment variables:')
  if (!PROJECT_REF)  console.error('   SUPABASE_PROJECT_REF  — found in Project Settings → General → Reference ID')
  if (!ACCESS_TOKEN) console.error('   SUPABASE_ACCESS_TOKEN — create at supabase.com/account/tokens')
  console.error('\nRun: doppler run -- npm run migrate\n')
  process.exit(1)
}

// ── Management API wrapper ────────────────────────────────────────────────────
//
// Supabase free-tier projects auto-pause after a week of inactivity. The first
// query after a pause wakes the project, but the wakeup itself can exceed the
// Management API's ~30s timeout, surfacing as HTTP 544 ("Connection terminated
// due to connection timeout"). Retry transient connection errors with
// exponential backoff so the runner doesn't bail on a cold start.
const TRANSIENT_STATUSES = new Set([502, 503, 504, 522, 524, 544])

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function runSql(sql, { maxAttempts = 4 } = {}) {
  let lastErr = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${MGMT_API}/v1/projects/${PROJECT_REF}/database/query`, {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
      })

      if (res.ok) return res.json()

      const body = await res.text().catch(() => '(no body)')

      // Transient — retry with backoff.
      if (TRANSIENT_STATUSES.has(res.status) && attempt < maxAttempts) {
        const wait = 2_000 * 2 ** (attempt - 1) // 2s, 4s, 8s
        const hint = res.status === 544 || res.status === 522 || res.status === 524
          ? '(project may be cold-starting)'
          : '(transient upstream error)'
        process.stdout.write(`\n    ↻  HTTP ${res.status} ${hint} — retrying in ${wait / 1000}s … `)
        await sleep(wait)
        continue
      }

      throw new Error(`HTTP ${res.status}: ${body.slice(0, 600)}`)
    } catch (err) {
      // Network-level failures (TLS, DNS, ECONNRESET) — also retryable.
      lastErr = err
      const networkError =
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT'  ||
        err.code === 'ENOTFOUND'  ||
        /fetch failed|network|timeout/i.test(err.message ?? '')
      if (networkError && attempt < maxAttempts) {
        const wait = 2_000 * 2 ** (attempt - 1)
        process.stdout.write(`\n    ↻  ${err.message} — retrying in ${wait / 1000}s … `)
        await sleep(wait)
        continue
      }
      throw err
    }
  }
  throw lastErr ?? new Error('runSql exhausted retries')
}

// ── Bootstrap: ensure schema_migrations table exists ─────────────────────────
async function ensureMigrationsTable() {
  await runSql(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT        PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
}

// ── Load the set of already-applied migration filenames ───────────────────────
async function getAppliedMigrations() {
  try {
    const rows = await runSql('SELECT filename FROM schema_migrations ORDER BY filename;')
    return new Set(Array.isArray(rows) ? rows.map(r => r.filename) : [])
  } catch {
    // Table may not exist yet — will be created by ensureMigrationsTable
    return new Set()
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀  Nexus migration runner`)
  console.log(`    Project: ${PROJECT_REF}\n`)

  await ensureMigrationsTable()

  const applied = await getAppliedMigrations()

  // Read and sort migration files
  const allFiles = (await readdir(MIGRATIONS_DIR))
    .filter(f => f.endsWith('.sql'))
    .sort()

  const pending = allFiles.filter(f => !applied.has(f))

  if (pending.length === 0) {
    console.log('✅  All migrations are up to date.\n')
    return
  }

  console.log(`    ${applied.size} already applied, ${pending.length} pending\n`)

  let applied_count = 0

  for (const filename of pending) {
    process.stdout.write(`    ⏳  ${filename} … `)
    const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8')

    try {
      await runSql(sql)
      // Record as applied
      await runSql(
        `INSERT INTO schema_migrations (filename) VALUES ('${filename.replace(/'/g, "''")}')
         ON CONFLICT (filename) DO NOTHING;`
      )
      console.log('✅  done')
      applied_count++
    } catch (err) {
      console.log('❌  FAILED')
      console.error(`\n    Error in ${filename}:\n    ${err.message}\n`)
      console.error('    Migrations stopped. Fix the error above and re-run.\n')
      process.exit(1)
    }
  }

  console.log(`\n✅  Applied ${applied_count} migration${applied_count !== 1 ? 's' : ''} successfully.\n`)
}

main().catch(err => {
  console.error('\n❌  Unexpected error:', err.message)
  process.exit(1)
})
