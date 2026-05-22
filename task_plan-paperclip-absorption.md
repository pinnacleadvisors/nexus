# task_plan — Paperclip absorption

> Long-horizon plan per [AGENTS.md §Long-Horizon Task Protocol](AGENTS.md#long-horizon-task-protocol). Pre-read [ADR-007](docs/adr/007-paperclip-absorption.md) and [`docs/research/paperclip-audit-2026-05.md`](docs/research/paperclip-audit-2026-05.md) before starting Phase 2.

---

## North Star

**Goal:** Nexus's UI surface, schema, and runtime-routing fabric absorb Paperclip's proven platform patterns (companies-first-class, goal ancestry, threaded issues with checkout lock semantics, unified approval inbox, adapter architecture, mobile-responsive board view) **without** migrating to Paperclip as runtime.

**Success criteria:**
- A new operator can land at `/companies` and see every business as a tile with budget + recent issues + pending approvals — replacing today's single-business focus.
- Every dispatched task has a verifiable ancestry chain ending at a company-level goal, visible in the issue detail view.
- Pending approval gates from any business surface in a single `/approvals` inbox, typed by the existing 5-category gate matrix.
- The strategist (`solopreneur-loop`) emits adapter-agnostic dispatches; a new runtime (`groq_local`, `together_remote`, etc.) requires adding one adapter file, not modifying dispatch routes.
- Migrations are idempotent and each is paired with a fail-soft helper following the [`lib/board/insert-task.ts`](lib/board/insert-task.ts) pattern. Running each migration twice is a no-op.
- `npx tsc --noEmit` + `npm run check:retry-storm` + `npm run check:sentry-config` pass on every commit.

**Hard constraints:**
- Cannot copy contents from [`paperclipai/companies`](https://github.com/paperclipai/companies) — no license. Format/recipe absorption only.
- Cannot break the 5-category gate matrix or the strategist auto-pivot.
- Cannot break `lib/cost-guard.ts` pre-dispatch hard stop — outer safety stays as-is.
- Cannot break existing `business_slug` partition-key invariant on `experiment_metrics`, `token_events`, `run_events`, `connected_accounts`, `tasks`.
- Single Write/Edit/Bash call ≤ 300 lines / 10 KB (enforced by [`.claude/hooks/check-write-size.sh`](.claude/hooks/check-write-size.sh)).

---

## Phase 1 — Audit (complete)

- [x] Read paperclipai/paperclip @ commit `c91a06232625` — schema, server, UI, docs
- [x] Verify license + star count + companion repo license
- [x] Map every Paperclip schema file to a Nexus mapping
- [x] Decide Coolify obsolescence (verdict: keep, layer adapter architecture on top)
- [x] Ship audit doc + ADR-007 + this task plan (PR — see Phase 1 deliverables)

**Phase 1 PR scope:** [`docs/research/paperclip-audit-2026-05.md`](docs/research/paperclip-audit-2026-05.md), [`docs/adr/007-paperclip-absorption.md`](docs/adr/007-paperclip-absorption.md), this task plan, [`docs/adr/INDEX.md`](docs/adr/INDEX.md) update.

---

## Phase 2 — Schema absorption (5 migrations, each ≤ 1 atomic task)

Pre-Phase-2 gate: PgBouncer lock-semantics spike per audit §11.1. Estimated 1 dev day. If spike fails, fall back to advisory locks (`pg_advisory_xact_lock`) and document in ADR addendum.

### Task 2a — Migration 046_companies_promotion.sql

- File: `supabase/migrations/046_companies_promotion.sql`
- Change: Add `business_operators.mission TEXT NULL`, `board_members JSONB DEFAULT '[]'`, `parent_org_id TEXT NULL REFERENCES business_operators(slug) ON DELETE SET NULL`. All `IF NOT EXISTS`.
- Verify: re-run migration is no-op; existing app code unaffected (untouched columns NULL by default).
- Parallel: no (foundation for 2b–2e).

### Task 2b — Migration 047_goals.sql + fail-soft helper

- File: `supabase/migrations/047_goals.sql`, `lib/goals/insert.ts`
- Change: New `goals(id UUID, business_slug TEXT, title TEXT, success_criteria TEXT, parent_goal_id UUID NULL, status TEXT, created_at TIMESTAMPTZ)` with `(business_slug)` index. Fail-soft insert helper in pattern of `lib/board/insert-task.ts`.
- Verify: insert returns success when table exists; gracefully returns `{error: null}` when not (logs once).
- Parallel: yes (after 2a).

### Task 2c — Migration 048_issues.sql + fail-soft helper

- File: `supabase/migrations/048_issues.sql`, `lib/issues/insert.ts`
- Change: New `issues(id, business_slug, goal_id NULL, parent_id NULL self-FK, assignee_agent TEXT NULL, assignee_user TEXT NULL, status TEXT, status_category TEXT, title TEXT, body TEXT NULL, checkout_run_id UUID NULL, execution_run_id UUID NULL, created_at, updated_at)` + `issue_comments(id, issue_id, author_agent/user, body, created_at)`. CHECK constraint enforcing assignee_agent XOR assignee_user. Indices on `(business_slug)`, `(parent_id)`, `(goal_id)`.
- Verify: assignee constraint rejects rows with both set or neither set.
- Parallel: yes (after 2a).

### Task 2d — Migration 049_run_events_ancestry.sql

- File: `supabase/migrations/049_run_events_ancestry.sql`
- Change: `ALTER TABLE run_events ADD COLUMN IF NOT EXISTS goal_id UUID NULL`, `issue_id UUID NULL`. Optional FK references (deferred — RLS-friendly).
- Verify: re-run is no-op; existing `run_events` writes don't break (extend `lib/runs/log.ts` to accept the new fields, strip-on-missing-column).
- Parallel: yes (after 2c).

### Task 2e — Migration 050_approvals_first_class.sql

- File: `supabase/migrations/050_approvals_first_class.sql`, `lib/approvals/insert.ts`
- Change: New `approvals(id, business_slug, type TEXT, status TEXT, payload JSONB, created_by_agent TEXT, created_at, decided_at TIMESTAMPTZ NULL, decided_by_user TEXT NULL)` where `type ∈ ('niche_pick','domain_purchase','first_n_posts','paid_saas_signup','pricing_change')` via CHECK constraint. Insert helper.
- Verify: type CHECK rejects unknown gate names; existing `business_operators.approval_gates` JSONB stays as backstop (read both, prefer table).
- Parallel: yes (after 2a).

### Task 2 verification (after all five migrations)

- `npx tsc --noEmit` zero errors
- `npm run check:retry-storm` passes
- `npm run check:sentry-config` passes
- Apply migrations to local Supabase via `supabase db reset && supabase db push`
- Re-run each migration; each is a no-op
- Insert one row into each new table via Supabase Studio; helpers handle the missing-table state gracefully when columns rolled back

---

## Phase 3 — UI absorption (~10 atomic tasks, each ≤ 1 page or 2 components)

All pages mobile-responsive at 375px. Dark-mode tokens consistent with [`app/globals.css`](app/globals.css). Interactive components `'use client'`. Reuse existing `components/dashboard/*` patterns where they fit.

### Task 3a — `/companies` multi-business dashboard

- File: `app/(protected)/companies/page.tsx`, `components/companies/CompanyTile.tsx`
- Change: tile grid (one per `business_operators` row) with budget meter (from `experiment_metrics` cash_spend) + recent issue count + pending approval count + niche badge.
- Verify: render with seeded data in dev; mobile responsive.
- Parallel: yes.

### Task 3b — `/companies/[slug]` overview

- File: `app/(protected)/companies/[slug]/page.tsx`, `components/companies/MissionPanel.tsx`, `components/companies/GoalsTreePanel.tsx`
- Change: mission display + collapsible goals tree + linked agents list + budget summary.
- Parallel: yes.

### Task 3c — `/companies/[slug]/org-chart`

- File: `app/(protected)/companies/[slug]/org-chart/page.tsx`, `components/companies/OrgChart.tsx`
- Change: react-flow agent hierarchy reading from new `agents` table (or `lib/businesses/mcp-manifest.ts` fallback pre-Phase-4).
- Parallel: yes.

### Task 3d — `/companies/[slug]/issues` threaded ticket feed

- File: `app/(protected)/companies/[slug]/issues/page.tsx`, `components/issues/IssueRow.tsx`, `components/issues/IssueThread.tsx`, `components/issues/IssueAncestry.tsx`
- Change: filterable issue list + threaded detail view + breadcrumb ancestry (company → goal → parent → this issue).
- Parallel: yes (depends on Phase 2 issues table).

### Task 3e — `/approvals` unified inbox

- File: `app/(protected)/approvals/page.tsx`, `components/approvals/ApprovalCard.tsx`, `components/approvals/ApprovalDetail.tsx`
- Change: list of pending `approvals` rows across all businesses; card layout mirrors Paperclip's [`ApprovalCard.tsx`](https://github.com/paperclipai/paperclip/blob/master/ui/src/components/ApprovalCard.tsx) (audit §7) typed by 5-category matrix; click → detail view with approve/reject form.
- Parallel: yes (depends on Phase 2 approvals table).

### Task 3f — `components/companies/BudgetCards.tsx` triplet

- File: `components/companies/BudgetIncidentCard.tsx`, `BudgetPolicyCard.tsx`, `BillerSpendCard.tsx`
- Change: per audit §7 — three cards, NOT one `BudgetMeter`. Reads from `experiment_metrics` (existing) for spend-card; defer incidents/policies until Phase 4 wires the data source.
- Parallel: yes.

### Task 3g — `components/issues/CommentThread.tsx` + status timeline

- File: `components/issues/CommentThread.tsx`, `components/issues/StatusTimeline.tsx`
- Change: port from existing [`components/board/ReviewModal.tsx`](components/board/ReviewModal.tsx) status timeline + Paperclip's CommentThread layout.
- Parallel: yes.

### Task 3h — sidebar update + nav

- File: `components/layout/Sidebar.tsx`
- Change: add `Companies`, `Approvals`, `Issues` items; keep `Forge`, `Dashboard`, `Board`, `Tools`. Order TBD with user.
- Parallel: no (final UI integration step).

### Task 3 verification

- `npm run dev` → visit each new route
- 375px viewport check
- Approval inbox displays a seeded test approval
- Side-by-side comparison vs Paperclip's UI for `/approvals` and `/companies/[slug]/org-chart`; iterate until user signs off

---

## Phase 4 — Feature absorption (~7 atomic tasks)

Two threads: **adapter architecture** (the big one) and **per-task locks + ancestry**.

### Task 4a — `lib/adapters/types.ts` adapter interface

- File: `lib/adapters/types.ts`
- Change: define `Adapter` interface with `invoke(config, context?) → Promise<RunHandle>`, `status(handle) → Promise<AgentStatus>`, `cancel(handle) → Promise<void>`. `AgentStatus = 'idle' | 'running' | 'completed' | 'errored' | 'cancelled'`.
- Parallel: no (foundation).

### Task 4b — `lib/adapters/registry.ts` + 5 first adapters

- Files: `lib/adapters/registry.ts`, `lib/adapters/claude-gateway.ts`, `lib/adapters/codex-gateway.ts`, `lib/adapters/coolify-business.ts`, `lib/adapters/n8n.ts`, `lib/adapters/inngest.ts`
- Change: wrap existing services as adapters. Registry resolves adapter type → implementation. No behavioural change in this task — just abstraction.
- Verify: existing `/api/claude-session/dispatch` + `/api/n8n/dispatch` routes route through registry without behavioural change.
- Parallel: yes (after 4a) — five files, one per adapter, independent.

### Task 4c — `lib/issues/checkout.ts` atomic claim

- File: `lib/issues/checkout.ts`
- Change: `claimIssue(issueId, agentSlug) → checkoutRunId | null` via `SELECT ... FOR UPDATE SKIP LOCKED` (or advisory lock per Phase 2 spike outcome). Mirror `lib/webhooks/idempotency.ts` `claimEvent` pattern.
- Verify: parallel-fire test (`xargs -P 4` against `/api/cron/solopreneur-tick`) — exactly one claim succeeds per issue per cycle.
- Parallel: yes (after Phase 2 issues table lands).

### Task 4d — `lib/goals/ancestry.ts` walk

- File: `lib/goals/ancestry.ts`
- Change: `getAncestry(issueId) → { company, goal_chain[], parent_chain[] }`. Recursive CTE in SQL; one query per call (cached for the dispatch).
- Verify: returns full chain for a 3-deep test issue; returns just `{company}` for an issue with no goal/parent.
- Parallel: yes (after Phase 2).

### Task 4e — dispatch integration

- File: [`app/api/cron/solopreneur-tick/route.ts`](app/api/cron/solopreneur-tick/route.ts)
- Change: wrap every dispatch with `lib/issues/checkout.ts` + inject `lib/goals/ancestry.ts` chain into prompt. NO change to strategist itself.
- Verify: traceability test — every emitted dispatch in `run_events` has a `goal_id` set and a verifiable ancestry chain.
- Parallel: no.

### Task 4f — `lib/templates/` loader (original templates only)

- File: `lib/templates/load.ts`, `lib/templates/types.ts`, plus 1–2 original Nexus templates as proof
- Change: read a template directory matching Paperclip's COMPANY.md + agents/ + skills/ + .nexus.yaml format. Provision: insert `business_operators` row + seed agents + register skills. **All template contents are original Nexus content, not copied from `paperclipai/companies`.**
- Verify: `node scripts/seed-from-template.ts <name>` creates a new business with seeded agents.
- Parallel: yes (after Phase 2).

### Task 4g — `lib/cost-guard.ts` per-agent breakdown

- File: `lib/cost-guard.ts` (extend, not rewrite)
- Change: add `getAgentBudget(agentSlug, businessSlug, period: 'day' | 'week' | 'month') → {spent, cap, remaining}` reading from `experiment_metrics` (already partitioned by agent if we extend payload). Outer USD/day kill switch unchanged.
- Verify: existing `assertUnderCostCap` test still passes; new helper returns plausible breakdown for a seeded business.
- Parallel: yes.

### Task 4 verification

- Run a full `solopreneur-loop` cycle on a test business — strategist + gate matrix unchanged.
- Trigger `/api/cron/solopreneur-tick` twice in parallel via `xargs -P 2`; verify `lib/issues/checkout.ts` prevents double-dispatch (unique claim invariant).
- Trigger a `domain_purchase` gate; verify it appears in `/approvals` AND Slack AND blocks dispatch until approved.
- Dispatch over daily USD cap → rejected at `lib/cost-guard.ts` BEFORE LLM call (grep instrumented log line).
- `memory_search` MCP query for the test business — memory-hq writes still flow.

---

## Timeline

- **Phase 1** — complete (this PR).
- **Phase 2** — 1 week. PgBouncer spike (1d) + 5 migrations + helpers + verification (4d).
- **Phase 3** — 2–3 weeks. ~10 atomic tasks, mostly parallelisable. Two dependency edges (3a→3h, 3d/3e gated on Phase 2).
- **Phase 4** — 2 weeks. Adapter foundation (4a→4b: 5d) + checkout/ancestry/dispatch (4c–4e: 3d) + templates + cost-guard extension (4f, 4g: 2d).
- **Total** — 6 weeks from Phase 2 kickoff.

## Risks

- **PgBouncer transaction-pooling vs `SELECT FOR UPDATE`** — spike before Task 4c lands. Fallback: `pg_advisory_xact_lock`.
- **Schema churn breaking existing app code** — every migration paired with fail-soft helper. `npm run check:retry-storm` catches the missing-helper case.
- **Audit drift** — re-pin audit to a later Paperclip commit if Phase 2 starts more than 4 weeks after 2026-05-22.
- **Scope creep into Paperclip-lookalike** — out of scope explicitly: chat replacement, code-review tool, Jira clone. Stay board-level.

## Progress (as of 2026-05-22)

### Completed

- [x] Phase 1 — Paperclip @ `c91a06232625` audit, ADR-007, this plan. Verified license, schema gaps, UI mappings, adapter architecture. Decided to keep Coolify containers and layer adapter abstraction on top.

### Remaining

- [ ] Phase 2 — PgBouncer spike then 5 migrations (046–050) + helpers.
- [ ] Phase 3 — 8 atomic UI tasks.
- [ ] Phase 4 — 7 atomic feature tasks; biggest is adapter registry + 5 adapters.

### Blockers / Open Questions

- Sidebar nav order — needs user input in Phase 3h.
- Whether to fold `dashboard/` and `board/` into the new `/companies` view or keep them — defer to Phase 3 walkthrough.
- Attribution policy — NOTICE.md vs `package.json#notice` — decide before any verbatim code copy.
