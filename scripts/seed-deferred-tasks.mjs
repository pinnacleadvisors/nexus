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
// Each row is { title, description, due_at?, category }. Categories help
// the operator filter; they're stored in the description prefix so the
// existing TasksView (which doesn't have a category column yet) still groups
// them visually via title prefix.

const BACKLOG = [
  // Hygiene / autonomous (in this codebase, no operator env needed)
  {
    category: 'hygiene',
    title:    '[hygiene] task_plan.md B8 — lib/withGuards.ts wrapper over top-10 mutating routes',
    description: 'Introduce a single guard wrapper (origin + auth + ratelimit + optional costCap) and migrate the top 10 mutating routes behind a feature flag. Plan: task_plan.md.',
  },
  {
    category: 'hygiene',
    title:    '[hygiene] task_plan.md B11 — .husky/pre-commit hook for scripts/scan-secrets.sh',
    description: 'Wire the existing secret-scan script into a husky pre-commit hook so accidental .env / token paste fails the commit before push.',
  },
  {
    category: 'hygiene',
    title:    '[hygiene] task_plan.md B12 — public-surface rate-limit bucket audit',
    description: 'Audit every public surface (sign-in, OAuth callback, webhooks) for distinct rate-limit buckets; document the strategy in lib/ratelimit.ts.',
  },
  {
    category: 'hygiene',
    title:    '[hygiene] lean-mode iter 2 — Board UI button for skill-promote',
    description: 'Backend route POST /api/skills/[slug]/promote already exists (PR-pre-lean). Add a button in components/board/ReviewModal.tsx that surfaces draft skills with a Promote action. Backend wiring complete; UI missing.',
  },
  {
    category: 'hygiene',
    title:    '[hygiene] lean-mode iter 2 — re-push 11 orphan atoms through memory_atom MCP',
    description: 'memory-hq MCP was 503 during the original survey run, so 11 atoms only landed in memory/molecular/ local cache. Re-push via mcp__memory-hq__memory_atom once the MCP recovers; alternative: cli.mjs --backend=github after exporting MEMORY_HQ_TOKEN.',
  },
  {
    category: 'hygiene',
    title:    '[hygiene] memory-architecture Step 8 — branch-per-agent + GitHub App',
    description: 'Deferred until rate limits actually bite. Move from PAT-based writes to a GitHub App with one branch per agent. Not urgent until concurrent writes increase.',
  },

  // Strategic surfaces (multi-day, focused)
  {
    category: 'strategic',
    title:    '[strategic] debug-loop-oss Stream T1 — Layer-by-layer integration spike',
    description: '~2 days. Eval-then-decide checkpoint built in. Prerequisite for Stream B (business-ops smoke pack). Plan: task_plan-debug-loop-oss-frameworks.md.',
  },
  {
    category: 'strategic',
    title:    '[strategic] Paperclip absorption Phase 2 — PgBouncer + migrations 058-062',
    description: 'PgBouncer spike then 5 migrations + adapter helpers. Prerequisite for Phase 3 (UI) and Phase 4 (adapter registry). Plan: task_plan-paperclip-absorption.md.',
  },
  {
    category: 'strategic',
    title:    '[strategic] Paperclip UI Phase 2 — Tasks B-G (≈5-7 days)',
    description: 'B signals_briefing skill (shipped), C Ctrl+K palette, D Agent profiling page, E Heartbeat scheduling viz, F Bento-grid Mission Control, G visual style sweep. Plan: task_plan-paperclip-ui-phase-2.md.',
  },
  {
    category: 'strategic',
    title:    '[strategic] chat-views V2-V4 — Connected accounts → Live activity → Memory panels',
    description: 'V1 (Notes + Esc-close) shipped via PR #311. V2-V4 sequenced by complexity. Plan: task_plan-chat-views.md.',
  },
  {
    category: 'strategic',
    title:    '[strategic] codex-debug-loop Phases 2-4 — closed-loop debug agent',
    description: 'Phase 1 verification primitives shipped (Playwright suite + /api/health/deep). Phase 2 = the loop agent itself (forks bug-hunt-loop), Phase 3 = per-branch sandbox, Phase 4 = wire to QA failures. Plan: task_plan-codex-debug-loop.md.',
  },
  {
    category: 'strategic',
    title:    '[strategic] platform-improvements Tracks 4-6 — open decisions for owner',
    description: 'Open questions: (4) slack_webhook_url encryption migration, (5) backfill policy on lineage, (6) /manage-platform middleware exposure decision. Operator-decision-gated.',
  },

  // Not started
  {
    category: 'not-started',
    title:    '[new] learning-system T1-T5 — Duolingo-style learning UI on molecular memory',
    description: 'Foundation, card generation + sync, session API, UI, wiring. None started. Plan: task_plan-learning-system.md.',
  },
  {
    category: 'not-started',
    title:    '[new] user-tester-panel — synthetic-persona feedback into workflow_feedback',
    description: '5 atomic tasks (persona gen, per-persona eval, synthesis, agent spec, chat block). Plan: task_plan-user-tester-panel.md.',
  },
  {
    category: 'not-started',
    title:    '[new] thai-sales-agency — English-language Thailand sales pipeline',
    description: 'Entire plan gated on operator approval. AI avatar runs first-call discovery + demo, operator approves closes from Board. Plan: task_plan-thai-sales-agency.md.',
  },

  // Operator-environment (no code work, just operator clicks)
  {
    category: 'operator-env',
    title:    '[operator] autonomous-qa rollout — Clerk bot user + Doppler vars + log drain',
    description: '7-step checklist in services/qa-runner/README.md: create qa-bot Clerk user, set BOT_*/QA_RUNNER_*/VERCEL_LOG_DRAIN_SECRET in Doppler, configure Vercel log drain, apply migration 022, deploy qa-runner on Coolify, smoke-test, then set CLAUDE_MAX_ONLY=1.',
  },
  {
    category: 'operator-env',
    title:    '[operator] execution-overhaul pilot — push Dockerfile.business + pilot one business',
    description: 'Push Dockerfile.business to GHCR, pick one low-stakes business, run Phases A-F of docs/runbooks/per-business-container-rollout.md, gather ≥7 days of telemetry. Plan: task_plan-execution-overhaul.md.',
  },
  {
    category: 'operator-env',
    title:    '[operator] lean-mode — KVM tier check + Doppler vars + flip LEAN_MODE=1',
    description: 'Confirm KVM tier supports privileged containers (podman info | grep rootless), generate NEXUS_SANDBOX_TOKEN, set LEAN_MODE=1 + LLM_PROVIDER=claude + LEAN_USER_DAILY_USD_LIMIT in Doppler, then activate Mimo/Ollama when Claude Max ends.',
  },
  {
    category: 'operator-env',
    title:    '[operator] solopreneur-experiment Phase 3 Group A — 6 parallel foundation tasks',
    description: 'Plan: task_plan-solopreneur-experiment.md. Gated on operator approval to start Group A (Coolify container + Composio seed + brand voice + KPI baselines, etc.).',
  },

  // Harness absorption — Group D follow-up
  {
    category: 'follow-up',
    title:    '[follow-up] edit-self block — wire EditSelfCard into chat MessageBubble',
    description: 'PR #316 shipped server-side parsing + persistence + agent grammar. Card component is ready. Follow-up PR: 1 import + 1 render block in PlatformChat MessageBubble + same in BusinessChat. ~20 lines total.',
  },
]

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
