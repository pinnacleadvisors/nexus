#!/usr/bin/env node
/**
 * Post-apply verification for migration 044.
 *
 * Confirms:
 *   1. schema_migrations has the row for 044
 *   2. tasks counts match pre-apply (0 rows had derivable lineage, so 0 were
 *      backfilled — table state is unchanged)
 *   3. Re-running the UPDATE statement directly returns 0 affected rows
 *      (idempotency confirmed)
 *
 * Read-only except for the BEGIN/ROLLBACK idempotency probe.
 *
 * Usage:
 *   doppler run -- node scripts/verify-044-applied.mjs
 */

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
  if (!res.ok) {
    const body = await res.text().catch(() => '(no body)')
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 500)}`)
  }
  return res.json()
}

async function main() {
  console.log('\n=== Verification — migration 044 applied state ===\n')

  console.log('1) schema_migrations row:')
  const row = await q(`
    SELECT filename, applied_at
    FROM   schema_migrations
    WHERE  filename = '044_tasks_backfill_business_slug.sql';
  `)
  console.table(row)

  console.log('\n2) tasks counts (should be unchanged from pre-apply):')
  const counts = await q(`
    SELECT
      (SELECT COUNT(*) FROM tasks)                                  AS total_tasks,
      (SELECT COUNT(*) FROM tasks WHERE business_slug IS NOT NULL)  AS slug_set,
      (SELECT COUNT(*) FROM tasks WHERE business_slug IS NULL)      AS slug_null;
  `)
  console.table(counts)

  console.log('\n3) Idempotency probe (BEGIN…ROLLBACK):')
  console.log('   Re-running the UPDATE inside a transaction — expected 0 affected:')
  const idem = await q(`
    BEGIN;
    WITH updated AS (
      UPDATE tasks t
      SET    business_slug = bo.slug
      FROM   business_operators bo
      WHERE  t.business_slug IS NULL
        AND  t.run_id        IS NOT NULL
        AND  bo.current_run_id = t.run_id
      RETURNING t.id
    )
    SELECT COUNT(*)::int AS rows_that_would_update FROM updated;
    ROLLBACK;
  `)
  console.table(idem)

  console.log('\nDone.\n')
}

main().catch(err => {
  console.error('Verification failed:', err.message)
  process.exit(2)
})
