# Task Plan — Platform Improvements (Post-Phase-A Hardening)

Goal: Tighten the "idea → run → board → publish" loop so a single owner can run an autonomous business with only three jobs — supply ideas, approve work, watch finances. Fix stale board state, broken webhook→card flow, missing failure surfacing, and the empty Learn page. Produce a publishable onboarding guide for future multi-tenant testers.

Success criteria:
- [ ] Stale board cards from deleted ideas are detected and removed (auto + admin button).
- [ ] Adding a Slack webhook at `/settings/businesses` posts a verification message AND surfaces a confirmation card on `/board`.
- [ ] `/learn` has a "Sync now" button that POSTs to `/api/cron/sync-learning-cards`; users see the cron schedule (`0 5 * * *` UTC) inline.
- [ ] `docs/ONBOARDING.md` exists — covers signup → ALLOWED_USER_IDS → Doppler → first idea → first publish.
- [ ] All six security gaps below are either fixed or formally accepted with an ADR.
- [ ] Memory (`memory/molecular/`, `memory/roadmap/`) reflects 2026-04-24 → today's state (Phase A operator, business_operators table, learning system, etc.).
- [ ] Visible-failure surface: a single `/manage-platform/health` panel shows webhook health, cron last-run, gateway status, sentry counts.

Hard constraints:
- No mass deletions without dry-run + audit log.
- No new public surfaces without auth or signature gate (see B-section findings).
- Don't touch the `(protected)` Clerk matcher without writing an ADR — current set is intentional for multi-tenant flex (see Finding S1).
- Stay inside output cap (300 lines / 10 KB per Write/Edit).

---

## Phase 1 — Findings (Explore)

### F. User-flow friction (where the owner does manual work that could be automated)

| ID | Finding | Evidence |
|----|---------|----------|
| F1 | **Idea → Run requires 2 clicks** then board appears empty until phases advance manually. | `app/(protected)/forge/`, `components/forge/ForgeActionBar.tsx`, `app/api/runs/[id]/advance/route.ts` |
| F2 | **Webhook URL stored at `/settings/businesses` never produces a board card** — the `business_operators.slack_webhook_url` is outbound-only; n8n/claw webhooks ARE wired but no business webhook handler exists. | `app/api/webhooks/{n8n,claw}/route.ts` create cards; no `/api/webhooks/business/` |
| F3 | **No "test webhook" feedback** — owner can paste a wrong URL and never know. | `lib/slack/client.ts` has no `verify()` helper |
| F4 | **`/learn` shows "No cards yet" with no action button** — the cron is nightly (5 AM UTC) and not exposed in UI. | `app/(protected)/learn/page.tsx`, `vercel.json:23-25` |
| F5 | **Stale Kanban cards from deleted ideas never disappear** — `tasks` has no FK to `ideas` or `runs`; idea DELETE doesn't cascade. | `supabase/migrations/002_tasks_and_projects.sql`, `app/api/ideas/route.ts:60-79` |
| F6 | **Cron failures are silent** — runs log to console; no alert if `sync-learning-cards`, `rebuild-graph-hq`, or `metric-optimiser` errors. | `vercel.json` cron list, no `/api/cron/health` |
| F7 | **Idea DELETE swallows errors** with `.catch(() => {})` — owner thinks it deleted; server still has it. | `app/(protected)/idea/page.tsx:67` |
| F8 | **Run created with `ephemeral: true` when DB down** is invisible on dashboard. | `app/api/runs/route.ts:44-66` |

### S. Security gaps

| ID | Finding | Severity |
|----|---------|----------|
| S1 | **`proxy.ts` matcher only covers `/dashboard /forge /board /tools /build /graph /swarm`** — `/idea`, `/learn`, `/settings`, `/signals`, `/manage-platform` rely on the `(protected)` route group's layout for auth, NOT middleware. If a future page lands under `(protected)/x` without explicit layout `auth()`, it leaks. | High — easy to add a route and forget |
| S2 | **`/api/webhooks/n8n` accepts anonymous POSTs when `N8N_WEBHOOK_SECRET` unset** — silently bypasses sig check; production deploys without that env var are open. | High |
| S3 | **`/api/webhooks/claw` skips sig check when `OPENCLAW_BEARER_TOKEN` unset.** Same pattern. | High |
| S4 | **`business_operators.slack_webhook_url` stored plaintext.** A row leak exposes every owner's posting URL. | Medium — Slack URLs are sensitive |
| S5 | **`/api/cron/sync-memory` has no auth check** at all (per audit report). | High |
| S6 | **`/api/runs` returns `{ ephemeral: true }` on DB failure** — same payload shape as success, easy for client to ignore. | Low (consistency) |
| S7 | **`ENCRYPTION_KEY` dev-fallback warns but continues** — staging deploys could silently store user_secrets with the static key. | Medium |

### M. Memory freshness audit

`memory/roadmap/SUMMARY.md` says "Last updated 2026-04-24" but the repo now contains:
- `024_business_operators.sql` (Phase A — autonomous operator) — not in roadmap.
- `task_plan-thai-sales-agency.md`, `task_plan-claude-gateway.md`, `task_plan-autonomous-qa.md` — not indexed.
- `business_operators` table conflict-rename (commit `b7d1af2`) — no atom.
- `claude-code-gateway` Coolify deploy notes — already atomized but no Phase 17b/18b status update.
- `services/claude-gateway/` exists — `memory/platform/ARCHITECTURE.md` does not mention it.
- 12 atoms total in `memory/molecular/atoms/`; `log.md` is 10 lines — graph is sparse.

---

## Phase 2 — Plan (atomic tasks)

Tasks are sized to fit one tool call under the 300-line cap. `Parallel: yes` tasks can be dispatched concurrently.

### Track 1 — Onboarding guide (deliverable the user explicitly asked for)

```
### Task 1.1 — Write docs/ONBOARDING.md
- File:    docs/ONBOARDING.md (new)
- Change:  step-by-step: Clerk signup → grab user_id → set ALLOWED_USER_IDS → Doppler → seed business → first idea → first run → first publish; explain platform in elegant prose at the top.
- Verify:  read back; smoke-test by following it end-to-end on a fresh Clerk account.
- Parallel: yes
```

### Track 2 — Stale board card cleanup

Cards have NO `idea_id` / `run_id` FK. Two options: (a) add columns now and backfill, (b) detect stale via `milestone_id` + `project_id` heuristics. Recommend (a) — additive migration, no breaking change.

```
### Task 2.1 — Migration 025_tasks_lineage.sql
- File:    supabase/migrations/025_tasks_lineage.sql (new)
- Change:  ALTER TABLE tasks ADD COLUMN idea_id UUID REFERENCES ideas(id) ON DELETE SET NULL;
           ALTER TABLE tasks ADD COLUMN run_id  UUID REFERENCES runs(id)  ON DELETE SET NULL;
           ALTER TABLE tasks ADD COLUMN business_slug TEXT;
           CREATE INDEX tasks_idea_id_idx ON tasks(idea_id) WHERE idea_id IS NOT NULL;
- Verify:  apply via Supabase CLI; run \d tasks
- Parallel: no (foundation for 2.2–2.4)

### Task 2.2 — Backfill + nightly orphan sweep cron
- File:    app/api/cron/sweep-orphan-cards/route.ts (new)
- Change:  query tasks WHERE (idea_id IS NULL AND milestone_id ~ '^idea_') OR
           (idea_id IS NOT NULL AND idea NOT EXISTS) → DELETE with audit log entry per row. CRON_SECRET gated. Dry-run mode `?dryRun=1`.
- Verify:  POST with ?dryRun=1; expect counts only.
- Parallel: yes (after 2.1)

### Task 2.3 — Wire cron into vercel.json
- File:    vercel.json
- Change:  add `{ "path": "/api/cron/sweep-orphan-cards", "schedule": "30 4 * * *" }` (10 min after sync-memory)
- Verify:  schema check; redeploy.
- Parallel: yes (after 2.2)

### Task 2.4 — Admin "Clean orphans now" button
- File:    app/(protected)/manage-platform/page.tsx
- Change:  add button that POSTs to /api/cron/sweep-orphan-cards?dryRun=1, displays counts, then offers a destructive "Confirm delete" button.
- Verify:  click in dev; confirm card removed from board.
- Parallel: yes (after 2.2)

### Task 2.5 — Update card-creation paths to stamp lineage
- File:    app/api/agent/route.ts, app/api/build/research/route.ts,
           app/api/webhooks/{n8n,claw}/route.ts, app/api/runs/route.ts
- Change:  every tasks.insert() should include idea_id, run_id, business_slug when known.
- Verify:  npx tsc --noEmit; create one card via each path; check columns populated.
- Parallel: yes (after 2.1)
```

### Track 3 — Webhook → card + Slack verification

```
### Task 3.1 — lib/slack/client.ts: add postVerification()
- File:    lib/slack/client.ts
- Change:  export async function postVerification(webhookUrl, channel?, businessName?) — sends a test Block Kit message: "✅ Nexus connected to <business>. This channel will receive approval requests, run summaries, and alerts." Returns { ok, error? }.
- Verify:  unit-friendly; call with valid + invalid URLs.
- Parallel: yes

### Task 3.2 — Verification on PATCH /api/businesses
- File:    app/api/businesses/route.ts
- Change:  when slack_webhook_url changes, call postVerification(); if it fails, return 200 but include `{ slack_warning: '<reason>' }` so UI can surface it; if ok, also INSERT a tasks row { title: '🔌 Slack connected', column_id: 'review', business_slug, idea_id: NULL } so the owner sees a visible confirmation card.
- Verify:  paste a bad URL → see warning + no card; paste a good URL → see card and Slack message.
- Parallel: yes (after 3.1)

### Task 3.3 — Surface slack_warning in /settings/businesses UI
- File:    app/(protected)/settings/businesses/page.tsx
- Change:  read `slack_warning` from POST response; render inline next to the field with retry button.
- Verify:  manual test.
- Parallel: yes (after 3.2)
```

### Track 4 — /learn manual sync button

```
### Task 4.1 — Add "Sync now" button to /learn
- File:    app/(protected)/learn/page.tsx
- Change:  Mirror the /signals "Run council now" pattern (loading state, POST /api/cron/sync-learning-cards, refresh). Show inline help text: "Cron runs daily at 05:00 UTC. Click to sync immediately." Show last sync timestamp from /api/learn/stats response.
- Verify:  click in empty state; confirm cards appear if mol_atoms exist.
- Parallel: yes

### Task 4.2 — Expose lastSyncedAt in /api/learn/stats
- File:    app/api/learn/stats/route.ts (or wherever it lives)
- Change:  query MAX(updated_at) from flashcards; include `lastSyncedAt` in response.
- Verify:  curl response; field present.
- Parallel: yes
```

### Track 5 — Visible failures dashboard (new self-improvement loop)

```
### Task 5.1 — /api/health/cron route
- File:    app/api/health/cron/route.ts (new)
- Change:  query log_events for last successful run of each cron; return { jobs: [{ path, lastRunAt, lastStatus, ageMinutes }] }; auth via ALLOWED_USER_IDS.
- Verify:  curl returns all 5 cron jobs.
- Parallel: yes

### Task 5.2 — /manage-platform health panel
- File:    app/(protected)/manage-platform/page.tsx
- Change:  add a "System health" card grid: each cron job row, gateway ping (Claude Code gateway URL), recent Sentry errors count, webhook last-received times. Color: green/amber/red.
- Verify:  visit page in dev.
- Parallel: yes (after 5.1)
```

### Track 6 — Security hardening

```
### Task 6.1 — ADR + tighten proxy.ts matcher
- File:    docs/adr/003-protected-route-matcher.md (new), proxy.ts
- Change:  ADR documenting the layout-vs-middleware split. Then add /idea, /idea-library, /learn, /settings, /signals, /manage-platform to the matcher (defense-in-depth).
- Verify:  unauthenticated curl to /learn returns 302.
- Parallel: yes

### Task 6.2 — Webhook signature: fail-closed in production
- File:    app/api/webhooks/n8n/route.ts, app/api/webhooks/claw/route.ts
- Change:  if NODE_ENV==='production' AND secret unset → return 503 "webhook not configured" instead of skipping the check.
- Verify:  unit + manual.
- Parallel: yes

### Task 6.3 — /api/cron/sync-memory auth gate
- File:    app/api/cron/sync-memory/route.ts
- Change:  add isCronAuthed() check matching sync-learning-cards.
- Verify:  curl without bearer → 401.
- Parallel: yes

### Task 6.4 — Encrypt slack_webhook_url at rest
- File:    supabase/migrations/026_encrypt_slack_webhook.sql + lib/business/operator.ts
- Change:  rename column to slack_webhook_url_enc; encrypt with lib/crypto.ts on write; decrypt on read.
- Verify:  round-trip a row.
- Parallel: no (depends on 3.x)
```

### Track 7 — Memory base sync

```
### Task 7.1 — Update memory/roadmap/SUMMARY.md and PENDING.md
- File:    memory/roadmap/SUMMARY.md, memory/roadmap/PENDING.md
- Change:  add Phase A operator row; update Phase 23 status; bump "Last updated"; mark items completed since 2026-04-24.
- Verify:  diff readable; matches code.
- Parallel: yes

### Task 7.2 — Add 6 atoms for recent learnings
- File:    memory/molecular/atoms/*.md (6 new)
- Change:  business_operators-table-conflict-rename, sync-learning-cards-cron, slack-webhook-stored-plaintext, tasks-has-no-idea-fk, manage-platform-is-the-admin-surface, claude-gateway-services-folder-exists.
- Verify:  cli.mjs lint --write
- Parallel: yes

### Task 7.3 — Update memory/platform/ARCHITECTURE.md
- File:    memory/platform/ARCHITECTURE.md
- Change:  add services/claude-gateway/, /api/webhooks/{n8n,claw,slack,stripe}, /api/cron/* table.
- Verify:  read back.
- Parallel: yes
```

---

## Phase 3 — Implementation order

Bundles to commit per chunk (each one stream-safe):

1. **Foundation** — Tasks 2.1, 6.3, 7.1 (migration + cron auth + memory bump)
2. **Onboarding doc** — Task 1.1 (parallel-safe with #1)
3. **Webhook + Slack** — Tasks 3.1, 3.2, 3.3
4. **Stale-card cleanup** — Tasks 2.2, 2.3, 2.4, 2.5
5. **Learn UX** — Tasks 4.1, 4.2
6. **Health panel** — Tasks 5.1, 5.2
7. **Security pass** — Tasks 6.1, 6.2, 6.4
8. **Memory finish** — Tasks 7.2, 7.3

Each commit is independently revertable. Stop after each bundle; run `npx tsc --noEmit`; redeploy.

---

## Phase 4 — Self-improvement loops to seed

Add later, not in this plan, but flag:
- **Webhook health probe** — every 6h, POST a no-op event to each registered webhook URL; mark dead URLs amber.
- **Idea backlog grader** — daily, score `ideas` rows that haven't moved in 7 days; auto-archive scored ≤ 2/10 with notification.
- **Card retention sweep** — `completed` column tasks > 30 days move to a `tasks_archive` table.
- **Cron self-heal** — if `/api/health/cron` shows >2× expected gap, ping Slack.

---

## Progress

### Open questions for owner before Phase 3
1. **Track 6.4** — encrypting `slack_webhook_url` requires a one-time decrypt-write of existing rows. OK to write a migration script, or prefer manual re-paste in UI?
2. **Track 2.5** — backfilling lineage on existing tasks: leave NULL (orphan-sweep treats them as legacy-keep) or delete everything older than 30d in a one-time cleanup?
3. **Track 6.1** — adding `/manage-platform` to the middleware matcher: any future plan to expose subset publicly? If yes, leave out.
4. **Onboarding doc** — target audience confirmation: "future multi-tenant testers" implies inviting people; is the platform ready for that, or is the doc primarily a personal runbook for now?

### Decisions captured
- Stale-card cleanup: chose option (a) — add `idea_id`/`run_id` FKs — over heuristics. Cost is one migration; benefit is permanent deterministic cleanup.
- Webhook verification: chose UI-card + Slack message both, since the owner often watches Slack but works in the UI; both surfaces matter.
- Cron exposure: chose admin-only buttons via `ALLOWED_USER_IDS` rather than CRON_SECRET-only, so the owner has visible control without copying tokens.
