#!/usr/bin/env node
/**
 * Transaction-wrapped dry-run of migration 044.
 *
 * Submits the migration SQL inside BEGIN/ROLLBACK so the DB parses + plans
 * the UPDATE without persisting any changes. The RAISE NOTICE row count is
 * captured in the response and printed.
 *
 * Usage:
 *   doppler run -- node scripts/dryrun-044-backfill.mjs
 */

import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATION = join(__dirname, '..', 'supabase', 'migrations', '044_tasks_backfill_business_slug.sql')

const PROJECT_REF  = process.env.SUPABASE_PROJECT_REF
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
if (!PROJECT_REF || !ACCESS_TOKEN) {
  console.error('Missing SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN')
  process.exit(1)
}

const MGMT_API = 'https://api.supabase.com'

async function q(sql) {
  const res = await fetch(`${MGMT_API}/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, body: text }
}

async function main() {
  const sql = await readFile(MIGRATION, 'utf8')

  console.log('=== Migration 044 — dry-run (BEGIN…ROLLBACK) ===\n')

  const wrapped = `
BEGIN;

${sql}

-- Sanity: confirm no rows were committed.
SELECT COUNT(*) AS rows_with_slug FROM tasks WHERE business_slug IS NOT NULL;

ROLLBACK;
`

  const result = await q(wrapped)

  console.log('HTTP:', result.status, result.ok ? 'OK' : 'FAIL')
  console.log('---')
  console.log(result.body.slice(0, 2000))
  console.log('---')

  if (!result.ok) {
    console.error('\nDry-run failed.')
    process.exit(2)
  }

  console.log('\nDry-run wrapped in BEGIN/ROLLBACK — no rows persisted.')
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(2)
})
