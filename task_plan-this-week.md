# Task Plan — Week of 2026-05-24 (post-agent-process picks)

Goal: Close the remaining Tier-1 / Tier-2 items from the consolidated next-steps audit (after PRs #306-#309 landed) — finish in-flight work, ship chat-views V1, and close the basic operator-loop hygiene gaps from `task_plan-platform-improvements.md`.

Success criteria:
- PR #308 (migration-doc banners) merged to main.
- Task #16 (proxy.ts /api/cron/* 401) root-caused and fixed OR formally closed as "not a proxy.ts bug" with the real RCA written down.
- `Esc` closes any open chat view (`ViewsPanel`) — matches Claude Code reflex.
- `Notes` view ships as a per-scope (`admin` / `business:<slug>`) markdown scratchpad with debounced autosave + conflict warning.
- Stale board cards from deleted ideas auto-cleanup nightly via cron + admin "Clean orphans now" button.
- Slack webhook saves trigger a verification POST + auto-create a "🔌 Slack connected" Board card; failures surface inline in `/settings/businesses`.

Hard constraints:
- Stack rules in `AGENTS.md` + `memory/platform/STACK.md` (Next.js 16 App Router, `proxy.ts` not `middleware.ts`, `'use client'` boundary, shared types in `lib/types.ts`).
- Write-size discipline: every task fits one tool call under 300 lines / 10 KB. Skeleton-then-fill for any new file.
- Retry-storm rule: any new route called by auto-retrying services returns 200 + `{ok: false, error}` on transient failure, not 5xx.
- Mobile parity — anything UI-shaped passes the 375px viewport sniff (`npx playwright test --project=iphone`).
- One PR per branch. Branch dies on merge. New work = new branch off fresh `origin/main`.
- Memory: every notable finding gets one `memory_atom` linked to `[[mocs/<topic>]]`; trivial fixes skip.

---

## Phase 1 — Explore findings (filesystem-verified 2026-05-24)

| Original Tier-1 item | Status | Evidence |
|---|---|---|
| `docs/ONBOARDING.md` | ✅ Already shipped | 207-line file exists, covers signup → Doppler → first idea → first publish |
| codex-debug-loop DL1 (Playwright suite) | ✅ Already shipped | `tests/playwright/` has all 5 specs + mobile + viewport-meta |
| codex-debug-loop DL2 (`/api/health/deep`) | ✅ Already shipped | 188-line route exists, retry-storm-safe per the plan |
| paperclip-ui Task A (`create_business` agent) | ✅ Already shipped | `.claude/agents/create-business.md` (119 lines) wired into `/businesses/new` |
| PR #308 (migration-doc banners) | 🟡 OPEN, MERGEABLE, UNSTABLE | Conflict resolved locally per prior turn; needs push + merge |
| Task #16 — proxy.ts /api/cron/* 401 | 🔴 In-progress | qa-runner smoke returns 401; root cause TBD |
| Esc-close on `ViewsPanel` | 🔴 Missing | `ViewsDropdown` has Esc handling; `ViewsPanel` does not |
| Notes view | 🔴 Missing | No NotesView component, no `operator_notes` migration, no `/api/views/notes` route, not in `ViewsDropdown` menu |
| Stale-card cleanup | 🔴 Missing | `tasks` has no `idea_id` / `run_id` FK; no `/api/cron/sweep-orphan-cards` route in `vercel.json`'s cron list (route file exists but not wired) |
| Slack webhook verify | 🔴 Missing | `lib/slack/client.ts` has no `postVerification()`; PATCH /api/businesses doesn't verify |

**Net real work:** Blocks A, B, C, D below.

---

## Phase 2 — Atomic tasks (ordered)

### Block A — Close PR #308 + Task #16 (~30 min)

```
### Task A1 — Merge PR #308 to main
- Branch: chore/migration-doc-banners (resolved locally)
- Steps:  git push origin chore/migration-doc-banners (force-with-lease if rebased) → gh pr merge 308 --squash → confirm auto-delete; pull main
- Verify: gh pr view 308 --json state → "MERGED"
- Parallel: no

### Task A2 — RCA Task #16 (proxy.ts /api/cron/* 401)
- File:    services/qa-runner/src/index.ts + lib/auth/bot.ts + app/api/cron/post-deploy-smoke/route.ts
- Change:  Investigate. proxy.ts matcher runs Clerk on /api/* but isProtectedRoute() excludes /api/cron/* → no auth redirect. So the 401 must come from the route handler itself (authBotToken or CRON_SECRET check). Hypothesis: qa-runner sends the wrong bearer (BOT_BEARER_TOKEN instead of CRON_SECRET, or vice-versa) OR the cron route checks both but neither is set in qa-runner env.
- Outcome: EITHER a one-line route fix OR a docs update to qa-runner README clarifying which token to send. Whichever, write one memory_atom linking the finding to [[mocs/autonomous-qa]].
- Verify:  curl -H "Authorization: Bearer $TOKEN" https://<host>/api/cron/post-deploy-smoke returns 200/202.
- Parallel: yes (independent of A1)
```

### Block B — chat-views V1 (Esc + Notes) (~3-4 hours)

```
### Task B1 — Esc-close in ViewsPanel
- File:    components/chat-views/ViewsPanel.tsx
- Change:  Add useEffect at the top of the component body listening for "Escape" keydown → calls onClose. Matches ViewsDropdown's pattern (line 53). 10 LOC.
- Verify:  Open any view, press Esc, panel closes. npx tsc --noEmit clean.
- Parallel: yes

### Task B2 — Migration 056_operator_notes.sql
- File:    supabase/migrations/056_operator_notes.sql (new)
- Change:  CREATE TABLE operator_notes (id uuid pk, user_id text not null, scope text not null, body text not null default '', updated_at timestamptz default now(), unique(user_id, scope), CHECK scope = 'admin' OR scope LIKE 'business:%') + RLS allowing service-role full access. Idempotent (IF NOT EXISTS).
- Verify:  apply via psql / Supabase CLI; psql \d operator_notes shows the unique constraint.
- Parallel: yes

### Task B3 — API routes /api/views/notes
- File:    app/api/views/notes/route.ts (new)
- Change:  GET (?scope=...) returns {ok, note: {body, updated_at} | null}. PUT body {scope, body, expected_updated_at?} → upsert; if expected_updated_at set and DB row's updated_at differs, return 200 + {ok: false, conflict: true, current_updated_at}. Clerk auth() + ALLOWED_USER_IDS check; scope-format validated (admin or business:<slug>).
- Verify:  curl GET returns null on first call; PUT persists; second GET returns saved body; force a conflict by changing updated_at in DB → PUT returns conflict.
- Parallel: yes (depends on B2 migration)

### Task B4 — NotesView component
- File:    components/chat-views/NotesView.tsx (new, ~180-200 LOC)
- Change:  'use client'. Single <textarea> with monospace styling, debounced 800ms PUT to /api/views/notes, status line "Saved 12s ago | Saving… | Conflict — reload?". On conflict, show banner with "Discard local / Overwrite" buttons. Optional preview toggle using existing RenderedMarkdown from PlatformChat.
- Verify:  Mount with scope='admin'; type → 800ms later updated_at advances in DB. Open in second tab → second writes → first sees conflict banner.
- Parallel: yes (depends on B3)

### Task B5 — Wire Notes into ViewsDropdown + ViewsPanel
- File:    components/chat-views/ViewsDropdown.tsx, components/chat-views/ViewsPanel.tsx
- Change:  Add { id: 'notes', label: 'Notes', hint: 'Per-scope markdown scratchpad', Icon: StickyNote } to VIEWS. Extend ViewName type. Parent renders <NotesView scope=... /> when activeView === 'notes'.
- Verify:  Open Views menu, click Notes, type, refresh page, see content persisted.
- Parallel: no (depends on B4)
```

Ship Block B as one PR (`feat(chat-views): notes panel + esc-close`). All 5 tasks are well under the 300-line cap individually.

### Block C — Stale board card cleanup (~2 hours)

```
### Task C1 — Migration 057_tasks_lineage.sql
- File:    supabase/migrations/057_tasks_lineage.sql (new)
- Change:  ALTER TABLE tasks ADD COLUMN idea_id uuid REFERENCES ideas(id) ON DELETE SET NULL, ADD COLUMN run_id uuid REFERENCES runs(id) ON DELETE SET NULL, ADD COLUMN business_slug text. CREATE INDEX tasks_idea_id_idx ON tasks(idea_id) WHERE idea_id IS NOT NULL. Idempotent (ADD COLUMN IF NOT EXISTS).
- Verify:  apply; \d tasks shows new columns + FKs; existing rows have NULL.
- Parallel: no (foundation for C2-C4)

### Task C2 — Backfill + sweep cron route
- File:    app/api/cron/sweep-orphan-cards/route.ts (verify existing; create if missing per ls output)
- Change:  POST handler. Auth: CRON_SECRET OR authBotToken (mirrors post-deploy-smoke). Query: tasks WHERE (idea_id IS NULL AND milestone_id LIKE 'idea_%') OR (idea_id IS NOT NULL AND idea NOT EXISTS). DELETE with audit log per row. Dry-run mode via ?dryRun=1 returns counts only. Returns 200 always (retry-storm safe).
- Verify:  POST with ?dryRun=1 → counts; create one stale row + POST without dryRun → row deleted + audit entry written.
- Parallel: yes (after C1)

### Task C3 — Wire cron into vercel.json
- File:    vercel.json
- Change:  add `{ "path": "/api/cron/sweep-orphan-cards", "schedule": "30 4 * * *" }` (10 min after sync-memory).
- Verify:  npm run check:retry-storm clean; vercel.json valid JSON.
- Parallel: yes (after C2)

### Task C4 — Admin "Clean orphans now" button
- File:    app/(protected)/manage-platform/page.tsx
- Change:  Add a button under "Platform health" section that POSTs to /api/cron/sweep-orphan-cards?dryRun=1, displays counts inline, then offers a "Confirm delete" destructive button that POSTs without dryRun.
- Verify:  Click in dev — see dry-run counts; click confirm — orphan row removed from Board.
- Parallel: yes (after C2)

### Task C5 — Stamp lineage on insert paths
- File:    app/api/agent/route.ts, app/api/build/research/route.ts, app/api/webhooks/{n8n,claw}/route.ts, app/api/runs/route.ts, lib/board/insert-task.ts (helper)
- Change:  Extend insertTask() to accept { idea_id?, run_id?, business_slug? }. Every call site passes the known lineage. Backward-compat: if migration 057 not yet applied, helper drops the new columns silently (mirrors the 2026-05-03 fail-soft pattern).
- Verify:  npx tsc --noEmit clean; create one card via each path; verify columns populated.
- Parallel: yes (after C1)
```

Ship Block C as one PR (`feat(board): stale-card lineage cleanup`). Migration + cron + UI + insert-path patches — all small, all atomic.

### Block D — Slack webhook verify + auto-card (~1-2 hours)

```
### Task D1 — postVerification() in slack client
- File:    lib/slack/client.ts
- Change:  export async function postVerification(webhookUrl, businessName?) — sends a Block Kit message "✅ Nexus connected to <business>. This channel will receive approval requests, run summaries, and alerts." Returns { ok, error? }. Uses fetch with AbortSignal.timeout(8000); catches network errors → returns { ok: false, error: e.message }.
- Verify:  unit-friendly. Call with a real Slack test webhook URL → message lands. Call with bogus URL → returns { ok: false, error }.
- Parallel: yes

### Task D2 — Verify on PATCH /api/businesses + auto-card
- File:    app/api/businesses/route.ts
- Change:  On PATCH where slack_webhook_url changes, call postVerification(). If !ok, response includes `{ slack_warning: <reason> }` (200 always — don't 5xx the business save). If ok, ALSO insertTask({ title: '🔌 Slack connected', column_id: 'review', business_slug, idea_id: null }) so the owner sees a visible confirmation card.
- Verify:  PATCH with bad URL → slack_warning in response, no card. PATCH with good URL → no warning, card appears on Board.
- Parallel: yes (after D1 + C5 for lineage)

### Task D3 — Surface slack_warning in /settings/businesses UI
- File:    app/(protected)/settings/businesses/page.tsx
- Change:  Read slack_warning from PATCH response; render inline next to the webhook field as a yellow alert with a retry button. Clear on next successful save.
- Verify:  Manual: paste bogus URL → warning visible. Paste good URL → warning clears, card on /board.
- Parallel: no (depends on D2)
```

Ship Block D as one PR (`feat(slack): webhook verification + auto-card`).

---

## Phase 3 — Verify (Pre-commit gates per Block)

For every Block PR, run:
- `npx tsc --noEmit`
- `npm run check:retry-storm`
- `npm run check:sentry-config`
- `npm run check:topology`
- `npm run check:agent-spec-freshness` (if .claude/agents/* touched)
- For UI changes: `npx playwright test --project=iphone` (mobile parity)
- Pre-commit-checklist quick-scan from `AGENTS.md` (no secrets, no lucide-react missing icons, no Server-Component browser globals)

---

## Phase 4 — Memory writes (post-merge)

After each Block lands:

- **Block A** — `memory_atom` only if the Task #16 RCA produces a generalisable lesson (e.g. "qa-runner bearer-token mismatch — CRON_SECRET vs BOT_BEARER_TOKEN"); link to `[[mocs/autonomous-qa]]`.
- **Block B** — `memory_atom` for the Notes view shape (per-scope blob, last-write-wins, optimistic-concurrency via expected_updated_at); link to `[[mocs/chat-views]]` (create MOC if missing).
- **Block C** — `memory_atom` for the lineage-FK pattern (tasks.idea_id / run_id with ON DELETE SET NULL + sweep cron); link to `[[mocs/board-hygiene]]` (create MOC if missing).
- **Block D** — no atom unless a Slack vendor quirk surfaces (most likely trivial).

All writes use the MCP `memory_atom` tool (preferred). If MCP is 503, fall back to CLI: `node .claude/skills/molecularmemory_local/cli.mjs --backend=github atom "..." --fact="..."`.

---

## Phase 5 — Out-of-scope follow-ups (not in this plan)

These were in the broader tier list but defer to a future plan once Blocks A-D land:

- **Tier 3 hygiene** — `lib/withGuards.ts` (B8), husky pre-commit (B11), rate-limit bucket audit (B12) — file under `task_plan-platform-hardening.md` if not already.
- **Tier 4 — paperclip-absorption Phase 2** — PgBouncer + migrations 058-062 (numbering shifts now that 056-057 are claimed by this plan). Big enough to be its own focused plan.
- **Tier 5 — chat-views V2-V4** — Connected accounts panel → Live activity panel → Memory panel.
- **Tier 5 — learning-system, user-tester-panel, debug-loop-oss-frameworks Stream T1** — each a multi-day focused initiative.

---

## Progress

### Completed
- [x] Phase 1 exploration — filesystem-verified that 3 of 6 original Tier-1 items already shipped.
- [x] Phase 2 plan written.

### Awaiting operator approval
- [ ] Block A — PR #308 merge + Task #16 RCA
- [ ] Block B — chat-views V1 (Esc + Notes)
- [ ] Block C — stale-card cleanup (migration 057 + cron + UI + insert paths)
- [ ] Block D — Slack webhook verify + auto-card

### Open questions
- Block B Notes: confirm migration number 056 isn't claimed by an in-flight branch I can't see. (Latest in tree: 055_agent_library_hooks.sql.)
- Block C: should the orphan sweep be soft-delete (set deleted_at) or hard DELETE? Plan defaults to hard DELETE + audit log — matches the original Track 2 spec.
- Block D: if a business has multiple `slack_webhook_url`s over time (re-paste), do we re-verify each time or only when the value changes? Plan says only when the value changes (PATCH semantics).
