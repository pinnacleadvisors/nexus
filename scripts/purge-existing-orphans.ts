#!/usr/bin/env -S npx tsx
/**
 * One-shot purge of the current Board orphan flood.
 *
 * Why: migration 025_tasks_lineage.sql adds idea_id/run_id/business_slug to
 * `tasks`, but every pre-migration row has all three NULL. The user reported
 * "large backlog of to dos in agent board right now, from previous idea 'run'
 * clicks. these ideas have been deleted, but it is still on the board."
 *
 * This script soft-archives those legacy unanchored cards without waiting for
 * the nightly sweeper. It is safe to run multiple times: idempotent.
 *
 * Usage:
 *   # Dry run (default) — print only, no writes
 *   npx tsx scripts/purge-existing-orphans.ts
 *
 *   # Commit
 *   npx tsx scripts/purge-existing-orphans.ts --commit
 *
 * Env required:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY      (writes bypass RLS)
 *   PURGE_AGE_DAYS                 (optional, default 30)
 *
 * Decision Q2 in task_plan-ux-security-onboarding.md: leave NULL lineage
 * older than PURGE_AGE_DAYS soft-archived. Hard-delete is owned by the
 * nightly sweeper after the 7-day grace.
 */

import { createClient } from '@supabase/supabase-js'

interface TaskRow {
  id:            string
  title:         string
  column_id:     string
  created_at:    string
  archived_at:   string | null
  idea_id:       string | null
  run_id:        string | null
  project_id:    string | null
  milestone_id:  string | null
  business_slug: string | null
}

async function main() {
  const commit = process.argv.includes('--commit')
  const ageDays = Number(process.env.PURGE_AGE_DAYS ?? 30)
  const cutoff = new Date(Date.now() - ageDays * 86_400_000)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required')
    process.exit(1)
  }

  const sb = createClient(url, key, { auth: { persistSession: false } })

  console.log(`[purge] mode=${commit ? 'COMMIT' : 'dry-run'} ageDays=${ageDays} cutoff=${cutoff.toISOString()}`)

  const { data, error } = await sb
    .from('tasks')
    .select('id, title, column_id, created_at, archived_at, idea_id, run_id, project_id, milestone_id, business_slug')
    .is('archived_at', null)
    .is('idea_id', null)
    .is('run_id', null)
    .is('project_id', null)
    .is('milestone_id', null)
    .lt('created_at', cutoff.toISOString())
    .order('created_at', { ascending: true })

  if (error) {
    console.error(`[purge] query failed:`, error.message)
    process.exit(1)
  }

  const rows = (data ?? []) as TaskRow[]
  console.log(`[purge] candidates: ${rows.length}`)

  for (const r of rows.slice(0, 50)) {
    console.log(`  - ${r.created_at.slice(0, 10)}  [${r.column_id.padEnd(12)}]  ${r.id.slice(0, 8)}  ${r.title.slice(0, 80)}`)
  }
  if (rows.length > 50) console.log(`  … and ${rows.length - 50} more`)

  if (!commit) {
    console.log('')
    console.log(`[purge] DRY RUN — no writes performed`)
    console.log(`[purge] Re-run with --commit to soft-archive these ${rows.length} cards`)
    return
  }

  if (rows.length === 0) {
    console.log('[purge] nothing to do')
    return
  }

  const ids = rows.map(r => r.id)
  const { error: updErr, count } = await sb
    .from('tasks')
    .update({ archived_at: new Date().toISOString() })
    .in('id', ids)
    .select('id', { count: 'exact', head: true })

  if (updErr) {
    console.error(`[purge] update failed:`, updErr.message)
    process.exit(1)
  }

  console.log(`[purge] soft-archived ${count ?? ids.length} cards`)
  console.log(`[purge] hard-delete will run on the nightly sweeper after the 7-day grace`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
