# Task Plan — UX, Security, Onboarding & Self-Improvement Pass

Goal: Tighten the "idea → run → board → publish" loop so a single owner can run an autonomous business with only three jobs — supply ideas, approve work, watch finances. Fix stale board state, broken webhook→card flow, missing failure surfacing, and the empty Learn page. Produce a publishable onboarding guide for future multi-tenant testers.

## Success criteria
- Stale Board cards from deleted ideas are detected and removed (auto-sweep + admin button).
- Adding a Slack webhook at `/settings/businesses` posts a verification message AND surfaces a confirmation card on `/board`.
- `/learn` has a "Run sync now" button + visible cron schedule (`0 5 * * *` UTC) + last-sync timestamp.
- `docs/ONBOARDING.md` exists — covers signup → ALLOWED_USER_IDS → Doppler → first idea → first publish.
- All seven security findings (S1–S7) fixed or accepted via ADR.
- Single `/manage-platform` health panel shows webhook health, cron last-run, gateway status, Sentry counts.
- `memory/molecular/`, `memory/roadmap/`, `memory/platform/*` reflect 2026-05 reality.

## Hard constraints
- No mass deletion without dry-run + audit log + 7-day soft-archive grace.
- No auth tightening that breaks `BOT_API_TOKEN` / `BOT_CLERK_USER_ID`.
- No proxy.ts matcher change without an ADR.
- Each Write/Edit ≤ 300 lines / 10 KB. Each commit independently revertable.

## Decisions captured (open questions resolved)

| Q | Decision | Why |
|---|---|---|
| Q1 encrypt slack_webhook_url — script vs UI re-paste? | **Migration script** keeps old plaintext column for one release as fallback | Less owner toil; one-time |
| Q2 backfill lineage on existing tasks? | **Leave NULL** — sweeper handles legacy via `created_at < 30d`; one-shot script handles current flood | Avoids guess-work |
| Q3 add `/manage-platform` to middleware matcher? | **Yes** | Admin-only by definition |
| Q4 onboarding doc audience? | **Personal runbook + tester-ready** | Drift watcher (7.1) keeps it fresh |

---

## Findings

### F. User-flow friction
| ID | Issue | File |
|---|---|---|
| F1 | Idea → Run takes 2 clicks; board appears empty during early phases (defer — own plan) | `components/forge/ForgeActionBar.tsx` |
| F2 | `/settings/businesses` webhook → no Board card; no Slack ping | `app/api/businesses/route.ts` |
| F3 | No "test webhook" path; bad URL silent | `lib/slack/client.ts` |
| F4 | `/learn` empty state has dead text, no button | `app/(protected)/learn/page.tsx` |
| F5 | `tasks` lacks `idea_id`/`run_id`/`business_slug`; deleting an idea leaves cards | `supabase/migrations/002_tasks_and_projects.sql` |
| F6 | Cron failures silent; no `/api/health/cron` | `vercel.json` |
| F7 | `app/(protected)/idea/page.tsx:67` swallows DELETE errors with `.catch(()=>{})` | client bug |
| F8 | Run created `ephemeral: true` (DB down) is invisible | `app/api/runs/route.ts:44-66` |
| F9 | `ActiveRunsPanel` filters out `failed`/`blocked` | `components/dashboard/ActiveRunsPanel.tsx` |
| F10 | n8n `automations.import_error` captured but never shown | `app/(protected)/automation-library/page.tsx` |

### S. Security gaps
| ID | Issue | Severity |
|---|---|---|
| S1 | `proxy.ts` matcher misses `/idea /idea-library /learn /settings /signals /manage-platform` | High |
| S2 | `/api/webhooks/n8n` fail-OPEN when `N8N_WEBHOOK_SECRET` unset | High |
| S3 | `/api/webhooks/claw` fail-OPEN when `OPENCLAW_BEARER_TOKEN` unset | High |
| S4 | `business_operators.slack_webhook_url` plaintext at rest | Medium |
| S5 | `/api/cron/sync-memory` no auth | High |
| S6 | `/api/runs` returns `{ ephemeral: true }` shape-equivalent to success | Low |
| S7 | `ENCRYPTION_KEY` dev-fallback warns + continues — staging risk | Medium |
| S8 | Open RLS on `tasks/milestones/agents/alert_thresholds/revenue_events/token_events` | High once multi-user — gate with `MULTI_USER_MODE` |
| S9 | 39/103 API routes lack auth import; rely on `proxy.ts` only | High once multi-user |

### M. Memory freshness
- `memory/molecular/INDEX.md` last reindex 2026-04-28; today 2026-05-02.
- 12 atoms, 2 MOCs — missing: business_operators (mig 024), learning system (023), molecular_mirror (021), log_events (022), autonomous QA loop, signals, n8n strategist swarm gating, claude-gateway services folder, idea→run pipeline.
- `memory/roadmap/SUMMARY.md` last updated 2026-04-24; missing Phase A.
- `memory/platform/OVERVIEW.md` + `ARCHITECTURE.md` miss `/idea`, `/idea-library`, `/signals`, `/manage-platform`, `/automation-library`, `/settings/businesses`, plus `/api/{businesses,slack/{notify,decision},admin/issue-bot-session,vercel/log-drain,cron/{sync-learning-cards,sync-memory}}`.

---

## PRs (the order the operator approved — "Order of operations & PR strategy")

### PR 1 — Foundation (docs + memory + cron auth)
- **Task 1.1** `docs/ONBOARDING.md` — prose intro, 5-min setup, Day-1 walkthrough, "Where to look when something breaks", manual steps.
- **Task 1.2** `memory/molecular/` — 12 new atoms + 3 MOCs (`business-operator`, `autonomous-qa`, `learning-system`); regen INDEX; lint --write.
- **Task 1.3** `memory/platform/{OVERVIEW,ARCHITECTURE}.md` + `memory/roadmap/{SUMMARY,PENDING}.md` — add 7 missing pages, 12 missing API routes, Phase A row, Phase 22/23 status.
- **Task 6.3 (early)** `/api/cron/sync-memory` — add `isCronAuthed()` (S5 fix; folded in here so the foundation PR closes one security item).

### PR 2 — Learn UX
- **Task 4.1** `/api/learn/stats` — add `lastSyncedAt` (MAX `flashcards.updated_at`).
- **Task 4.2** `/learn` page — empty-state cron schedule + last-sync; "Run sync now" button POSTing `/api/cron/sync-learning-cards`.
- **Task 4.3** `app/(protected)/idea/page.tsx:67` — surface DELETE failures (F7).

### PR 3 — Orphan cleanup
- **Task 2.1** `supabase/migrations/025_tasks_lineage.sql` — add `idea_id`, `run_id`, `business_slug`, `archived_at` + indexes.
- **Task 2.2** `app/api/board/route.ts` — `.is('archived_at', null)` on GET; `?include_archived=1` flag.
- **Task 2.3** `app/api/cron/sweep-orphan-cards/route.ts` (new) + `vercel.json` `30 4 * * *` — soft-archive then 7-day hard-delete; `?dryRun=1`.
- **Task 2.4** Stamp lineage at insert in `app/api/agent/route.ts`, `app/api/build/research/route.ts`, `app/api/webhooks/{n8n,claw}/route.ts`, `inngest/functions/{index,research-loop}.ts`.
- **Task 2.5** `app/(protected)/manage-platform/page.tsx` — admin "Clean orphans now" button (dry-run preview → confirm).
- **Task 0.1** `scripts/purge-existing-orphans.ts` — one-shot to clear current Board flood (run after PR 3 lands).

### PR 4 — Webhook → Slack verification + Board card
- **Task 3.1** `lib/slack/client.ts` — `postVerification(webhookUrl, businessName?)`.
- **Task 3.2** `supabase/migrations/026_business_webhook_health.sql` — `webhook_last_verified_at`, `webhook_last_error`, `slack_webhook_url_enc`; migration script encrypts existing rows.
- **Task 3.3** `app/api/businesses/route.ts` POST + new `/api/businesses/verify-webhook` — verify on save; `slack_warning` field on POST response; standalone Verify button.
- **Task 3.4** Idempotent Board card insert on first verify (`🔌 <Business> — Slack connected`, column `review`, `business_slug` stamped).

### PR 5 — Visible failures panel
- **Task 5.1** `/api/health/cron` — query `log_events` for last successful run per cron route.
- **Task 5.2** `lib/cron/record.ts` — `recordCronRun(name, fn)` writes structured rows into `log_events` (no new table).
- **Task 5.3** `components/manage/HealthPanel.tsx` + `/manage-platform` — cron, gateway, webhook, spend, failed runs, n8n import errors, Sentry.
- **Task 5.4** Mission Control summary badge linking to `/manage-platform`.
- **Task 5.5** Surface ephemeral runs from `/api/runs` (F8/S6) — banner on `/idea` and `/forge`.

### PR 6 — Security pass
- **Task 6.1** `docs/adr/003-protected-route-matcher.md` + `proxy.ts` — add 6 missing routes to `isProtectedRoute`.
- **Task 6.2** `app/api/webhooks/{n8n,claw}/route.ts` — fail-closed in `NODE_ENV=production` when secret unset (S2 / S3).
- **Task 6.4** `lib/crypto.ts` + `docs/adr/004-encryption-key-policy.md` — fail-closed in production AND staging (S7).

### PR 7 — Self-improvement loops
- **Task 7.1** `app/api/cron/onboarding-drift/route.ts` — weekly diff `SECRETS.md` vs `ONBOARDING.md`.
- **Task 7.2** `lib/runs/funnel.ts` — idea→approval funnel metrics.
- **Task 7.3** `app/api/cron/review-nag/route.ts` — daily nag for >48h Review-column cards.
- **Task 7.4** `app/api/cron/webhook-probe/route.ts` — every 6h, probe each webhook; mark dead amber.
- **Task 7.5** Idea backlog grader (deferred — needs scoring rubric).
- **Task 7.6** Card retention sweep (deferred — pairs with `tasks_archive` migration).

### Deferred (gated by `MULTI_USER_MODE=1`)
- **Task 6.5** RLS narrow + `withGuards` rollout across 39 unauthed routes — when adding a 2nd tester.

---

## Implementation order (operator-approved)

1. PR 1 — Foundation (docs+memory+cron auth) — no code risk
2. PR 2 — Learn UX — fastest user-visible win
3. PR 3 — Orphan cleanup (then run `purge-existing-orphans.ts` to clear the flood)
4. PR 4 — Webhook verification + Board card
5. PR 5 — Visible failures panel
6. PR 6 — Security pass
7. PR 7 — Self-improvement loops

Each PR commits independently. After each: `npx tsc --noEmit` then proceed.

## Progress

- [x] Plan written and approved (2026-05-02)
- [ ] PR 1 — Foundation
- [ ] PR 2 — Learn UX
- [ ] PR 3 — Orphan cleanup
- [ ] PR 4 — Webhook verification
- [ ] PR 5 — Failures panel
- [ ] PR 6 — Security pass
- [ ] PR 7 — Self-improvement loops
