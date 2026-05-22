# Codex debug loop — autonomous iterate-until-passing agent

A Codex-driven loop that takes a failing surface (a Playwright spec, a `/api/health/deep` red light, a stack trace from `log_events`), proposes a fix in a draft PR against a per-branch dev container, and iterates until the verification layer reports green. **Phase 1 builds only the verification primitives** — the Playwright suite + deep health endpoint that turn "the agent made a change" into "the agent made a change AND we know whether it works end-to-end." Phases 2-4 wire those primitives into a closed loop; they are out of scope for the current initiative but specified here so Phase 1's interfaces don't paint Phase 2 into a corner.

The design intentionally mirrors the existing operator-gated loop pattern in AGENTS.md ([bug-hunt-loop](.claude/agents/bug-hunt-loop.md), [workflow-optimizer](.claude/agents/workflow-optimizer.md), [skill-trainer](.claude/agents/skill-trainer.md)) and the codex-via-sandbox routing in [ADR 002](docs/adr/002-codex-gateway-sandbox.md). Nothing here invents a new shape; the loop agent is bug-hunt-loop's structure plus skill-trainer's retry-until-pass primitive, executed inside ADR 002's sandbox tier.

## How this relates to existing infrastructure

| Surface | Status | What this initiative changes |
|---|---|---|
| `services/qa-runner/` Playwright (post-deploy smoke) | Shipped | **Unchanged.** Runs against the live Vercel deploy via the qa-bot Clerk ticket; lives in its own container; uses `/api/cron/post-deploy-smoke` as the trigger. This is the production safety net. |
| `tests/playwright/` (this initiative) | New (Phase 1) | Local + loop-time verification. Same Playwright framework, different working copy: runs against a dev server (local `npm run dev` for humans; per-branch dev container for Phase 2's loop). Operator-owned — Phase 2 enforces that the loop cannot edit this path. |
| `app/api/health/deep` | New (Phase 1) | Per-provider liveness — claude_gateway, codex_gateway, supabase, redis. Used by humans now; by the loop later to early-abort dispatches when an upstream is degraded. |
| `services/codex-gateway/` | Shipped (ADR 002) | **Unchanged in Phase 1.** Phase 2's loop agent dispatches through this gateway exactly like `codex-maintainer` already does. |
| `bug-hunt-loop` / `workflow-optimizer` | Shipped | Live exemplars of the operator-gated loop pattern. Phase 2's `codex-debug-loop` agent forks the bug-hunt-loop spec and replaces the iteration body. |
| `services/nexus-sandbox/` | Shipped (rootless-Podman) | Pattern for the Phase 2 per-branch dev container. The debug loop's dev sandbox is a sibling, not a fork — different lifetime (per-branch, weeks) vs nexus-sandbox (per-call, seconds). |

## North Star

**Goal:** Phase 1 ships the verification primitives so that a future autonomous loop can decide "passing" end-to-end without a human in the loop. Phase 2 builds the agent that closes that loop. Phase 3 hardens it for production. Phase 4 explores optional follow-ups.

**Success criteria (Phase 1 only):**
- Playwright suite at `tests/playwright/` covers five critical flows (sign-in, platform-chat, business-chat, settings/AI providers persistence, settings/skills list). Each test runs locally via `npx playwright test`. Failures emit screenshots + traces.
- `app/api/health/deep/route.ts` returns per-provider `{ok, latency_ms, error?}` for `claude_gateway`, `codex_gateway`, `supabase`, `redis`. 5s per-check timeout, 10s overall. Operator-only (`ALLOWED_USER_IDS`). 200 on individual failure (retry-storm safe).
- `AGENTS.md` documents the "Platform debug loop pattern" (its invariants + pointer to this plan for Phase 2-4 context). Slots between the existing Ralph loop section and "Write Size Discipline".
- `memory/platform/ARCHITECTURE.md` lists `/api/health/deep` in the API route list and `tests/playwright/` in the file structure section.
- `npx tsc --noEmit` and `npm run check:retry-storm` both clean before each push.

**Hard constraints:**
- **No loop agent built in Phase 1.** No dev sandbox container, no kickoff API, no `debug_loop_runs` table, no agent spec. All deferred.
- **Tests are operator-owned.** A future Phase 2 enforces this with a write-gate on the loop agent's branch protections. For Phase 1, just committing in a dedicated `tests/playwright/` directory establishes the boundary so the future enforcement is a simple `deny: ['tests/']` config, not a refactor.
- **Branch sync protocol** — `git fetch origin/main` + rebase before AND after every unit of work.
- **Write-size discipline** — single Write/Edit ≤ 300 lines / 10 KB. Skeleton-then-fill for new files; anchored Edits for refactors.
- **One atomic task per PR.** If any change exceeds the 300-line cap, split. PR descriptions always include a test plan checklist.
- **No autonomous decisions.** Task plan goes up first, waits for operator approval, then implementation begins.
- **No production mutations.** Phase 1 only adds files; it does not touch existing routes, agents, or infra.

## Phase 1 — Foundation (current initiative)

Three atomic tasks (B, C) plus two doc updates (D, E). Each lands its own PR.

### Task DL1 — Playwright suite + dev tooling (Deliverable B)

- **Files:** `playwright.config.ts` (root), `tests/playwright/sign-in.spec.ts`, `tests/playwright/platform-chat.spec.ts`, `tests/playwright/business-chat.spec.ts`, `tests/playwright/settings-ai-providers.spec.ts`, `tests/playwright/settings-skills.spec.ts`, `package.json` (devDependencies), `.gitignore` (test-results, playwright-report).
- **Change:** Add `@playwright/test` to **devDependencies only** (never ships to production runtime; matches `services/qa-runner/` shape but at the root). The five specs target the operator's daily golden path:
  1. `sign-in.spec.ts` — Clerk sign-in renders the form, submit redirects to `/dashboard` (or first protected page) when env-supplied `E2E_TEST_USER_EMAIL` / `E2E_TEST_USER_PASSWORD` are set; otherwise `test.skip()` with a console hint.
  2. `platform-chat.spec.ts` — `/manage-platform` chat tab, type a message into the input, assert an assistant bubble appears within 30s. Auth via the same Clerk-ticket mechanism qa-runner already uses (`BOT_SESSION_TICKET_URL`) when supplied; otherwise skip.
  3. `business-chat.spec.ts` — `/businesses/<slug>/chat`. Pick the first business in `/api/businesses` (skip if none exist), send a message, assert an assistant bubble. Same auth env.
  4. `settings-ai-providers.spec.ts` — `/settings?tab=ai`, find the Anthropic provider's tier dropdown, change it, reload, assert the change persisted. Catches the class of state regressions where the UI accepts a write but the server rejects it.
  5. `settings-skills.spec.ts` — `/settings?tab=skills`, assert ≥1 skill row renders (the Skills tab reads from `.claude/skills/`; any future regression where the API returns empty surfaces here).
- **Reuse:** `services/qa-runner/playwright.config.ts` is the template. Match its `outputDir`, `reporter`, `actionTimeout` choices. Key delta: the root config's `testDir` is `./tests/playwright`, not `./e2e`, and it does NOT pin `BASE_URL` — defaults to `http://localhost:3000` so a developer can `npm run dev` then `npx playwright test`.
- **Verify:** `npx playwright test --list` enumerates all 5 specs. `npx playwright test sign-in.spec.ts` runs (and skips gracefully if env vars are missing). `npx tsc --noEmit` includes the new specs without error.
- **Parallel:** yes (independent of C-D-E).
- **PR boundary:** ships its own PR. Split into two if the 5 specs together exceed the 300-line cap (one PR for config + sign-in; second PR for the other 4 specs).

### Task DL2 — Deep health endpoint (Deliverable C)

- **Files:** `app/api/health/deep/route.ts` (new).
- **Change:** GET handler that runs four checks in parallel via `Promise.allSettled`. Each check returns `{ok, latency_ms, error?, skipped?}`. Auth mirrors `app/api/health/db/route.ts` — Clerk `auth()` + `ALLOWED_USER_IDS` membership; 401 if unauthenticated, 403 if not in allowlist. Rate-limit 6/min (`rateLimit(req, {limit: 6, window: '1 m', prefix: 'health:deep'})`) so a stuck monitor can't hammer the upstream gateways.
  - `claude_gateway`: `GET <CLAUDE_CODE_GATEWAY_URL>/health` with `AbortSignal.timeout(5000)`. Skipped if env unset.
  - `codex_gateway`: `GET <CODEX_GATEWAY_URL>/health` with `AbortSignal.timeout(5000)`. Skipped if env unset.
  - `supabase`: service-role `SELECT id FROM tasks LIMIT 1` wrapped in `Promise.race([query, timeout(5000)])`.
  - `redis`: `GET <UPSTASH_REDIS_REST_URL>/ping` with bearer + 5s timeout. Skipped if env unset.
- **Response shape:** `{ ok: boolean, checks: { claude_gateway, codex_gateway, supabase, redis }, duration_ms }`. `ok` is `true` only when every non-skipped check has `ok: true`. The route returns HTTP **200 even when individual checks fail** — the per-check `ok` flag carries the signal (retry-storm safe; mirrors the rule in AGENTS.md for routes called by auto-retrying services).
- **Verify:** Hit `curl -H "Cookie: __session=..." http://localhost:3000/api/health/deep` locally — returns JSON with all four checks. Force a fail by temporarily setting `CLAUDE_CODE_GATEWAY_URL=https://nonexistent.invalid` — the claude check reports `ok: false` with the error string, response still 200, overall `ok` is `false`.
- **Parallel:** yes (independent of B).
- **PR boundary:** own PR. Single-file ≈ 150 lines; safely under the cap.

### Task DL3 — AGENTS.md "Platform debug loop pattern" section (Deliverable D)

- **Files:** `AGENTS.md` (anchored Edit, inserted between the existing "Operator-gated loop pattern (Ralph loop)" section and the "Write Size Discipline" section).
- **Change:** ~40-60 lines explaining (a) Phase 1 ships the verification primitives (Playwright + deep health); (b) Phase 2-4 add a closed-loop debug agent that consumes them; (c) the agent — when built — follows the Ralph loop invariants and lives in a sandboxed dev container per ADR 002. References `task_plan-codex-debug-loop.md` for the rest.
- **Verify:** `grep -n "Platform debug loop pattern" AGENTS.md` finds exactly one match. The section reads as a pointer + invariant summary, not a re-implementation of the Ralph loop table.
- **Parallel:** yes (depends only on this plan being approved).
- **PR boundary:** can bundle with task DL4 since both are tiny doc edits.

### Task DL4 — ARCHITECTURE.md route + tests directory (Deliverable E)

- **Files:** `memory/platform/ARCHITECTURE.md` (anchored Edits — one for `/api/health/deep` in the API list, one for `tests/playwright/` in the file structure).
- **Change:** Two ~1-line entries. Conservative — the existing file is the authority; don't rewrite, just append.
- **Verify:** `git diff memory/platform/ARCHITECTURE.md` shows only the additions.
- **Parallel:** yes (bundled with DL3 in one PR).

### Sequencing (Phase 1)

```
Approval gate     → operator OKs this plan
Day 1   DL2 (deep health)        ← simplest, smallest, immediate value
Day 1   DL3 + DL4 (doc updates)  ← bundled, one tiny PR
Day 2   DL1 (Playwright suite)   ← largest, lands last so it can reference the new deep-health endpoint if useful
```

Three PRs total; each operator-merged.

## Phase 2 — Closed-loop debug agent (out of scope for current initiative)

**Premise:** with Phase 1 in place, a Codex-driven agent can iterate "make a change → run Playwright + deep health → grade pass/fail → propose next iteration" until the verification layer reports green, all without a human in the loop until merge.

Atomic tasks (proposed, not built):

### Task DL5 — `debug_loop_runs` table + migration

- Table tracks each loop's `session_id`, `branch`, `iteration_count`, `verification_state` (last Playwright + deep-health snapshot), `cost_usd_so_far`, `status` ('running' | 'awaiting_merge' | 'failed' | 'merged'). Migration adds it idempotently with `IF NOT EXISTS`.
- Mirrors `runs` table conventions; reuses `business_slug` partition key (NULL = platform-wide debug).

### Task DL6 — Per-branch dev sandbox container

- New `services/debug-sandbox/` Compose stack: Next.js dev server + Postgres (Supabase docker image) + Redis, bound to a specific feature branch via `git worktree`. Lifetime: hours to days (lives as long as the debug session). Sibling to `services/nexus-sandbox/` but with a different lifecycle model.
- Per-session: one container instance, one ephemeral DB schema, one dev BASE_URL. The loop agent dispatches PRs against the branch, then runs Phase 1's Playwright suite + deep health against `BASE_URL=<dev-container-url>`.

### Task DL7 — Kickoff API + agent spec

- `POST /api/debug-loop/start` — body: `{ failing_signal, branch?, max_iterations?, max_cost_usd? }`. Authz: `ALLOWED_USER_IDS`. Idempotent (`session_id` derives from a hash of inputs; re-POST returns existing).
- `.claude/agents/codex-debug-loop.md` — forks `bug-hunt-loop.md`. Iteration body replaces "run static checks" with "dispatch a fix-attempt to codex-gateway, then run Phase 1 Playwright + deep-health, grade pass/fail per skill-trainer's `passes_required` semantic (default 3 consecutive passes), then propose next iteration".

### Task DL8 — Verification grader

- `lib/debug-loop/grade.ts` — pure function: `{ playwright_report, deep_health }` → `{ ok, regressions: string[], improvements: string[] }`. Drives the loop's stop/continue decision.

## Phase 3 — Production-readiness gates (out of scope)

### Task DL9 — PR template with iteration report

- `.github/PULL_REQUEST_TEMPLATE/debug-loop.md` — required when label `debug-loop` is set. Includes iteration count, final Playwright snapshot, final deep-health snapshot, list of files changed, memory-hq atom links if any.

### Task DL10 — Operator merge enforcement

- GitHub repo setting + branch protection: PRs labeled `debug-loop` require approving review from operator (not Claude / not codex bot). Loop agent has `gh pr ready` permission (un-draft) but NOT `gh pr merge`.

### Task DL11 — Per-iteration memory-hq snapshot

- After each loop iteration, write a `memory_atom` with `kind: 'agent-run'`, `importance: 'normal'`, linked to `[[mocs/codex-debug-loop]]`. Captures the change, the verification delta, the cost. Enables post-mortem grading + retroactive learning.

## Phase 4 — Optional follow-ups (out of scope)

- **Auto-trigger on failed CI** — GitHub Actions webhook fires `POST /api/debug-loop/start` automatically when a workflow on `main` goes red.
- **Multi-loop concurrency** — N loops running in parallel against N branches. Requires per-branch container quotas + cost-guard partition.
- **Per-business container debug variant** — same loop pattern but for the per-business container layer (PR-#5+ rollout). Targets business-side regressions rather than platform code.

## Out-of-scope (explicit, across all phases)

- **Auto-merge** anywhere in the system. Operator always merges. Period.
- **Codex editing the test files.** Loop agent's writable surface excludes `tests/playwright/` and the `playwright.config.ts` at the repo root. Enforced via the per-branch sandbox container's filesystem permissions (when built in Phase 2) — Phase 1 just establishes the directory boundary.
- **Replacing services/qa-runner.** The two systems serve different purposes: qa-runner = post-deploy production safety net (live Vercel); tests/playwright = local + loop-time verification (dev container). They share the Playwright framework but not the runtime.
- **A new gateway for the debug loop.** Phase 2 dispatches through the existing `services/codex-gateway/` per ADR 002. No new gateway service.
- **Multi-browser testing.** Single chromium project, matching qa-runner's deliberate choice (ADR-rationale: each browser multiplies dispatch cost without changing the failure signal).

## Sequencing (across all phases)

```
Phase 1 (current)    3-5 days, 3 PRs              ← THIS INITIATIVE
                     (gate: operator approval of this plan)

Phase 2 (future)     2-3 weeks, ~4 PRs            ← needs Phase 1 merged + new initiative spawned
                     (gate: at least 1 month of Phase 1 deep-health usage data)

Phase 3 (future)     1 week, ~3 PRs               ← needs Phase 2 stabilised
                     (gate: ≥10 clean Phase 2 loops on hand-curated failures)

Phase 4 (future)     open-ended                   ← prioritised only after Phase 3 graduates
```

## Progress

_Plan written 2026-05-22. Phase 1 implementation gated on operator approval of this document. Phases 2-4 specified for forward continuity but explicitly NOT built in the current initiative._
