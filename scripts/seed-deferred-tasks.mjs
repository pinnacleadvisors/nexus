#!/usr/bin/env node
/**
 * seed-deferred-tasks.mjs — populate operator_tasks with the deferred-audit
 * backlog so the operator can mark items done and other agents see status.
 *
 * Why: the audit across task_plan-*.md files surfaced ~30 deferred items
 * (hygiene gaps, operator-environment tasks, not-started plans). Until
 * they live in operator_tasks, agents can't cross-reference "is this
 * still pending?" — every session re-discovers the backlog from scratch.
 *
 * This script seeds them as `source='operator'` (operator-owned),
 * `scope='admin'` (platform-wide). Idempotent — upserts by (user_id,
 * scope, title) so re-running is safe. Already-done items stay done.
 *
 * Run:
 *   doppler run -- node scripts/seed-deferred-tasks.mjs --user-id=user_xxx
 *   doppler run -- node scripts/seed-deferred-tasks.mjs --user-id=user_xxx --dry-run
 *
 * Required env (from Doppler):
 *   SUPABASE_SERVICE_ROLE_KEY (for direct DB writes)
 *   NEXT_PUBLIC_SUPABASE_URL  (project URL)
 *
 * The user_id is the Clerk user_id of the operator (the one listed in
 * ALLOWED_USER_IDS). Find via: clerk dashboard → Users → copy ID.
 *
 * After this runs, the tasks appear in the chat Views dropdown → Tasks panel
 * (under the admin scope), and any agent that calls listTasks('admin') sees
 * them. Mark them done from the UI; the row's `done=true` becomes the
 * cross-agent truth.
 */

import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const userIdArg = args.find(a => a.startsWith('--user-id='))
const USER_ID = userIdArg ? userIdArg.split('=', 2)[1] : process.env.SEED_USER_ID

/**
 * Redact the user_id for log output. Clerk user_ids are non-secret
 * (they appear in URLs, in audit logs, etc.), but CodeQL conservatively
 * flags any process.env-sourced value logged in cleartext. Showing only
 * the prefix + suffix gives the operator enough to know which user the
 * script is operating on without tripping the lint.
 */
function redact(id) {
  if (!id || id.length < 12) return '<id>'
  return `${id.slice(0, 5)}…${id.slice(-4)}`
}

if (!USER_ID) {
  console.error('Usage: doppler run -- node scripts/seed-deferred-tasks.mjs --user-id=user_<clerk-id> [--dry-run]')
  console.error('       OR set SEED_USER_ID in env')
  process.exit(1)
}

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPA_URL || !SUPA_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
  process.exit(2)
}

// ── Backlog (deferred audit) ─────────────────────────────────────────────────
//
// Source of truth lives at lib/backlog/deferred-tasks.json so the inbox
// page's `POST /api/admin/seed-deferred-tasks` API uses the same list
// without drift. Edit the JSON to change the backlog; both consumers
// re-read on next run.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BACKLOG_PATH = resolve(__dirname, '..', 'lib', 'backlog', 'deferred-tasks.json')
const BACKLOG = JSON.parse(readFileSync(BACKLOG_PATH, 'utf8'))

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (DRY_RUN) {
    console.log(`[seed-deferred-tasks] DRY RUN — would seed ${BACKLOG.length} tasks for user_id=${redact(USER_ID)}\n`)
    for (const t of BACKLOG) {
      console.log(`  · ${t.title}`)
    }
    return
  }

  const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } })

  let upserted = 0
  let skipped  = 0
  let failed   = 0

  for (const item of BACKLOG) {
    // Skip if already present (idempotent). The schema doesn't constrain
    // unique-by-title, so we check first.
    const existing = await db
      .from('operator_tasks')
      .select('id, done')
      .eq('user_id', USER_ID)
      .eq('scope',   'admin')
      .eq('title',   item.title)
      .maybeSingle()

    if (existing.data) {
      skipped++
      console.log(`  · skip (exists, done=${existing.data.done}): ${item.title}`)
      continue
    }

    const ins = await db.from('operator_tasks').insert({
      user_id:     USER_ID,
      scope:       'admin',
      title:       item.title,
      description: item.description,
      source:      'operator',
      done:        false,
    })

    if (ins.error) {
      failed++
      console.error(`  ✗ failed: ${item.title} — ${ins.error.message}`)
    } else {
      upserted++
      console.log(`  ✓ seeded: ${item.title}`)
    }
  }

  console.log('')
  console.log(`Done. ${upserted} seeded, ${skipped} skipped (already existed), ${failed} failed.`)
  console.log('')
  console.log('Open the chat at /manage-platform → Views menu → Manual to-dos to see them.')
  console.log('When you complete one, click the checkbox; agents that call listTasks("admin") see done=true.')
}

main().catch(err => {
  console.error('[seed-deferred-tasks] fatal:', err instanceof Error ? err.message : err)
  process.exit(3)
})
