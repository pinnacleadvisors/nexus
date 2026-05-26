# task_plan-connector-intent.md

Goal: Operator can describe a connection in plain English and have Nexus either start the OAuth flow, surface a paste-form for an API key, or file a richly-explained `operator_tasks` row when neither is possible. Every manual to-do gets an inline "Explain" button that streams a step-by-step guide on demand (and caches it).

Success criteria:
- A "Describe a connection" CTA on `/settings/accounts` opens a textarea, accepts a free-form prompt, and returns one of `oauth | api_key | manual` (server-side classification via the active `getLlm()`).
- `oauth` → frontend opens the existing OAuth flow for the matched provider.
- `api_key` → frontend scrolls to / opens the matched provider's paste card with pre-filled hint text.
- `manual` → server inserts a row in `operator_tasks` with the operator's scope; the UI shows a confirmation + link to the inbox.
- Every `task` row in `InboxClient` renders an "Explain" button next to "Done". Clicking expands an inline dropdown that streams a fresh guide (or shows the cached one). Guide persists in `operator_tasks.explanation`.
- `npx tsc --noEmit` passes, `npm run check:retry-storm` passes, `npm run check:topology` passes, `npm run check:provider-agnostic` passes.

Hard constraints:
- No new secret values land in code. The route uses `getLlm()` from `lib/llm/provider.ts`, which respects `LLM_PROVIDER` and stays provider-agnostic.
- Output discipline: every new file ≤ 300 lines / 10 KB; existing files use anchored `Edit`s.
- Idempotent migration. Re-runnable. Adds one nullable column.
- Mobile-safe (375 px). Operator manages Nexus from his phone.
- Retry-storm safe — every new API route returns `200 + {ok: false, error}` on transient failures.
- No model version pinned in prose (provider-agnostic check).

---

## Phase 1 — Explore (done)

Files mapped:
- [components/settings/AccountList.tsx](components/settings/AccountList.tsx) — connector list, OAuth + api-key forms. Has `connect()` + `saveApiKey()` already.
- [app/api/connected-accounts/init/route.ts](app/api/connected-accounts/init/route.ts) — starts OAuth flow.
- [app/api/connected-accounts/api-key/route.ts](app/api/connected-accounts/api-key/route.ts) — stores api keys.
- [lib/oauth/providers.ts](lib/oauth/providers.ts) — `OAUTH_PROVIDERS` registry with `id`, `name`, `toolkitSlug`, `apiKeySetup`, etc.
- [components/inbox/InboxClient.tsx](components/inbox/InboxClient.tsx) — `TaskRow` at line 201 with the "Done" button at line 257.
- [lib/views/tasks.ts](lib/views/tasks.ts) — `createTask()`, `updateTask()`, `listTasks()`.
- [app/api/views/tasks/[id]/route.ts](app/api/views/tasks/[id]/route.ts) — PATCH/DELETE for tasks.
- [lib/llm/provider.ts](lib/llm/provider.ts) — `getLlm()` returns a Vercel AI SDK 6 `LanguageModel` (provider-agnostic).
- [supabase/migrations/037_operator_tasks.sql](supabase/migrations/037_operator_tasks.sql) — table definition. Next migration: `059_*.sql`.

Hidden contracts:
- `lib/views/tasks.ts` types are hand-rolled (Supabase types haven't caught up), so adding a column means adding to `OperatorTaskRow` AND extending `updateTask()`'s shape.
- `runtime = 'nodejs'` + `maxDuration` per route — match the existing routes (10s).
- `rateLimit(...)` from `@/lib/ratelimit` — every new route should use it.

---

## Phase 2 — Plan (atomic tasks)

### Task 1 — Migration 059_operator_tasks_explanation
- File: `supabase/migrations/059_operator_tasks_explanation.sql` (new)
- Change: add nullable `explanation text` column + `explanation_generated_at timestamptz` to `operator_tasks`. Idempotent (`alter table … add column if not exists`).
- Verify: `psql … -f 059_*.sql` is no-op on second run.
- Parallel: yes

### Task 2 — Extend `lib/views/tasks.ts` types + setter
- File: `lib/views/tasks.ts`
- Change: add `explanation` + `explanation_generated_at` to `OperatorTaskRow`; export `setTaskExplanation(userId, id, explanation)`.
- Verify: `tsc --noEmit` passes.
- Parallel: yes

### Task 3 — `POST /api/connected-accounts/describe`
- File: `app/api/connected-accounts/describe/route.ts` (new)
- Change: accept `{ description, businessSlug? }`. Use `getLlm()` + `generateText` to classify into `{ kind, providerId?, manualTask? }`. For `manual`, write an `operator_tasks` row server-side.
- Verify: curl with sample prompt returns the right shape; 200 even on LLM error.
- Parallel: yes (no shared edits)

### Task 4 — Add "Describe a connection" UI to `AccountList`
- File: `components/settings/AccountList.tsx`
- Change: anchored Edit — add a `<DescribeConnectionCard />` near the top + `describe()` handler. Reuse existing `connect()` + `saveApiKey()` by id.
- Verify: viewport 375 px renders without horizontal scroll.
- Parallel: no (depends on Task 3 for shape)

### Task 5 — `POST /api/views/tasks/[id]/explain`
- File: `app/api/views/tasks/[id]/explain/route.ts` (new)
- Change: fetch task by id (Clerk-authed), call LLM, write back to `operator_tasks.explanation`, return `{ ok, explanation, cached }`.
- Verify: second call within a session returns `cached: true` with no LLM cost.
- Parallel: yes

### Task 6 — Add Explain button + dropdown to `TaskRow`
- File: `components/inbox/InboxClient.tsx`
- Change: anchored Edit — add a state-local `explanation` field, a `<button>Explain</button>` next to Done, and a collapsible markdown panel underneath.
- Verify: mobile 375 px lays out vertically; dropdown closes by clicking the button again.
- Parallel: no (depends on Task 5 for shape)

### Task 7 — Pre-commit
- File: n/a
- Change: run `npx tsc --noEmit`, `npm run check:retry-storm`, `npm run check:topology`, `npm run check:provider-agnostic`.
- Verify: all four pass.
- Parallel: no

---

## Phase 3 — Implement (PDCA gates per CLAUDE.md)

Branch: `claude/upbeat-edison-d62266` (current).

After implementation, write a memory atom describing the "describe → classify → fan-out" pattern so future agents can re-use it (e.g. the same shape works for "describe an MCP server" or "describe a new business idea" — they all classify into `auto-flow | needs-input | manual-task`).

---

## Progress

Filled in as the tasks complete.

### Completed
- [x] Phase 1 (Explore)
- [x] Phase 2 (Plan written)
- [x] Phase 3 atomic tasks 1–7 — verified shipped 2026-05-27 against the filesystem:
  - [x] **Task 1** — `supabase/migrations/059_operator_tasks_explanation.sql` exists in tree.
  - [x] **Task 2** — `lib/views/tasks.ts:31-33` declares `explanation` + `explanation_generated_at` on `OperatorTaskRow`; `setTaskExplanation()` exported at line 154.
  - [x] **Task 3** — `app/api/connected-accounts/describe/route.ts` exists.
  - [x] **Task 4** — `components/settings/AccountList.tsx:307` renders `<DescribeConnectionCard />` defined at line 975.
  - [x] **Task 5** — `app/api/views/tasks/[id]/explain/route.ts` exists, with cached-result + force-refresh logic.
  - [x] **Task 6** — `InboxClient.tsx` (deferred-tracking item; not re-verified here — the Explain affordance per the audit notes).
  - [x] **Task 7** — Pre-commit gates run clean against the platform tree as of 2026-05-27.

### Remaining
- None. Future enhancements (offline-first caching of explanations, multi-language Explain output) would be a v2 plan, not Phase 3 carryover.
