#!/usr/bin/env node
/**
 * Read-only diagnostic — pre-flight for migration 044_tasks_backfill_business_slug.
 *
 * Counts how many `tasks` rows have NULL business_slug, and partitions them
 * by what lineage signals are available:
 *
 *   - lineage_via_current_run  → tasks.run_id matches business_operators.current_run_id
 *                                (the only schema-level path from a task to a slug today)
 *   - has_run_id_only          → tasks.run_id set, but run is no longer "current" for any business
 *   - has_idea_id_only         → no run_id, just idea_id (no schema path to business_slug)
 *   - has_project_id_only      → no run_id/idea_id, just project_id (no slug derivable)
 *   - orphan_no_lineage        → genuinely unlineaged
 *
 * Usage:
 *   doppler run -- node scripts/diagnose-tasks-business-slug.mjs
 *
 * Read-only — does NOT mutate any row. Safe to run against prod.
 */

const PROJECT_REF  = process.env.SUPABASE_PROJECT_REF
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN

if (!PROJECT_REF || !ACCESS_TOKEN) {
  console.error('Missing SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN. Run via: doppler run -- node scripts/diagnose-tasks-business-slug.mjs')
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

const QUERY = `
WITH null_slug AS (
  SELECT id, project_id, run_id, idea_id, created_at
  FROM   tasks
  WHERE  business_slug IS NULL
),
classified AS (
  SELECT
    n.id,
    CASE
      WHEN n.run_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM business_operators bo WHERE bo.current_run_id = n.run_id
      )                                          THEN 'lineage_via_current_run'
      WHEN n.run_id     IS NOT NULL              THEN 'has_run_id_no_current_match'
      WHEN n.idea_id    IS NOT NULL              THEN 'has_idea_id_only'
      WHEN n.project_id IS NOT NULL              THEN 'has_project_id_only'
      ELSE                                            'orphan_no_lineage'
    END AS bucket
  FROM null_slug n
)
SELECT bucket, COUNT(*)::int AS row_count
FROM   classified
GROUP  BY bucket
ORDER  BY row_count DESC;
`

const HEADER = `
SELECT
  (SELECT COUNT(*) FROM tasks)                                  AS total_tasks,
  (SELECT COUNT(*) FROM tasks WHERE business_slug IS NOT NULL)  AS slug_already_set,
  (SELECT COUNT(*) FROM tasks WHERE business_slug IS NULL)      AS slug_null,
  (SELECT COUNT(*) FROM business_operators)                     AS business_operators_total,
  (SELECT COUNT(*) FROM business_operators WHERE current_run_id IS NOT NULL) AS business_operators_with_current_run;
`

const SAMPLE = `
SELECT
  t.id           AS task_id,
  t.title,
  t.run_id,
  bo.slug        AS would_backfill_to,
  t.created_at
FROM   tasks t
JOIN   business_operators bo ON bo.current_run_id = t.run_id
WHERE  t.business_slug IS NULL
LIMIT  10;
`

const SAMPLE_ORPHANS = `
SELECT
  t.id, t.title, t.assignee, t.column_id, t.created_at,
  t.project_id, t.run_id, t.idea_id, t.milestone_id
FROM   tasks t
WHERE  t.business_slug IS NULL
ORDER  BY t.created_at DESC
LIMIT  15;
`

const BUSINESS_OPERATORS_SAMPLE = `
SELECT slug, name, status, current_run_id, last_operator_at, created_at
FROM   business_operators
ORDER  BY created_at DESC
LIMIT  10;
`

async function main() {
  console.log('\n=== Discovery — tasks.business_slug backfill candidates ===\n')

  console.log('Header counts:')
  const header = await q(HEADER)
  console.table(header)

  console.log('\nBackfill bucket breakdown:')
  const buckets = await q(QUERY)
  console.table(buckets)

  console.log('\nSample (up to 10) rows that WOULD be backfilled via current_run_id:')
  const sample = await q(SAMPLE)
  console.table(sample)

  console.log('\nAll NULL-business_slug rows (orphan sample):')
  const orphans = await q(SAMPLE_ORPHANS)
  console.table(orphans)

  console.log('\nBusiness operators present in DB:')
  const bos = await q(BUSINESS_OPERATORS_SAMPLE)
  console.table(bos)

  console.log('\nDone. No rows mutated.\n')
}

main().catch(err => {
  console.error('Discovery failed:', err.message)
  process.exit(2)
})
