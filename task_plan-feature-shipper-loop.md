# task_plan-feature-shipper-loop.md — Autonomous Feature Shipper Agent (planning only)

Closed-loop feature-shipping agent that composes the autonomy pattern demonstrated in the 2026-05-26 50-min claude-gateway session — namely: pick a bounded plan, write the code + tests, run the checks, iterate, manage a stacked PR queue, audit mergeability, and stop honestly. The agent runs inside a fresh git worktree per session, opens only DRAFT PRs, and never auto-merges.

## North Star

```
Goal:             A managed agent the operator can invoke from /manage-platform
                  chat that ships a single bounded feature end-to-end (plan →
                  code → tests → checks → PR → mergeable audit) without
                  human intervention. Each cycle = one feature = one PR.
                  Mirrors the discipline a senior contributor demonstrates
                  but does not require one to be online.

Success criteria: - Operator types "/ship-feature <task_plan-slug>" → agent
                    spins up a fresh worktree, reads the named plan, picks
                    the highest-leverage atomic task, implements it, runs
                    every required pre-commit check, opens a draft PR, and
                    ends the cycle with a `cycle-report` block.
                  - Each cycle takes < 90 min of wall-clock and < 25% of
                    the 5h plan-window budget. Per-cycle USD cap obeyed
                    via cost-guard.
                  - Agent ALWAYS opens draft PRs — never auto-merges.
                  - When a cycle produces a stacked PR (parent PR still open),
                    agent runs the reset+cherry-pick recovery pattern
                    documented in CLAUDE.md → "Default recovery for
                    stacked-PR branches whose parents merged" if needed.
                  - When two consecutive cycles produce zero net-new
                    shippable signal, agent emits `scope: "stop"` instead
                    of `"continue"`.
                  - Agent recognises and refuses speculative / requires-
                    operator / pure-polish / needs-real-data tasks rather
                    than ploughing through them.

Hard constraints: - NEVER auto-merges or pushes to main.
                  - NEVER cross an operator approval gate (deploy, env
                    write, secret rotation, customer-facing message,
                    payment mutation) — emits a `manual-task` block.
                  - NEVER edits files under `tests/playwright/` if the
                    test was authored by a human or copilot — those are
                    operator-owned (mirrors codex-debug-loop's invariant).
                  - Hard cap by cost-guard kill-switch
                    (USER_DAILY_USD_LIMIT). Cycle aborts when triggered.
                  - Single Write/Edit/Bash ≤ 300 lines per call.
                  - Every PR is draft + tagged `feature-shipper` +
                    base=main.
                  - Every PR body links to the plan slug it advances
                    AND the cycle's `cycle-report` block id.
```

## Why this exists — the autonomy gap

The 2026-05-26 50-min session demonstrated that a single claude-gateway session, given the right framing (North Star + memory access + AGENTS.md discipline rules), can:

- Plan a multi-PR feature progression
- Write code + tests at AGENTS.md-grade quality
- Run every pre-commit check + verify they're green
- Open well-formatted PRs with sensible bodies
- Manage stacked-PR branches (reset+cherry-pick when parents merge)
- Audit mergeability at session end
- Stop honestly when the remaining work is speculative / blocked

But that depth lives in the **gateway session**, not in any persistent agent the operator can invoke on demand. The operator currently has to start a chat, restate the framing, and personally drive each iteration. That's the autonomy gap.

This agent closes it. The persistent agent IS the framing. Operator just says "ship X" and walks away. Drafts PRs they review at their pace.

## Phase status

| Phase | Scope | Status | Notes |
|---|---|---|---|
| **S0** | This plan PR | ⏳ Awaiting operator approval | The plan-only PR (this file) ships first |
| **S1** | New `feature-shipper-loop` agent spec | ⏳ Planned | Forks from `skill-trainer` (closed-loop) + `bug-hunt-loop` (operator gates) |
| **S2** | `feature_shipper_cycles` table + migration | ⏳ Planned | Persists per-cycle state across worktree lifetimes |
| **S3** | `/api/feature-shipper` route — start / next / pause / stop | ⏳ Planned | Server-side state machine |
| **S4** | UI: "Feature shipper" view in chat Views dropdown | ⏳ Planned | Cycle log + open-PR pile + controls |
| **S5** | Worktree spawn helper — `lib/worktrees/spawn.ts` | ⏳ Planned | Per-cycle worktree creation + cleanup, mirrors `.claude/worktrees/` pattern |
| **S6** | Mergeability auditor — `lib/feature-shipper/mergeability.ts` | ⏳ Planned | Stacked-PR collision detection + reset+cherry-pick recovery |
| **S7** | Cost guard + cycle-termination heuristic | ⏳ Planned | Plan-window share + USD cap + stop-eligible signals |

S1 + S5 + S6 must land together (PR-1) — the agent has no useful runtime without the worktree primitive and the auditor. S2 + S3 + S4 ship next (PR-2) for persistence + UI.

> **No code in this plan PR.** This is the planning-only PR per the brief's phase F. Implementation PRs follow when the operator approves.

---

## Protocol — `cycle-report` block

The agent emits one `cycle-report` block per cycle, parallel to the `iteration-plan` block of `bug-hunt-loop`. The poll route persists it to `feature_shipper_cycles`.

```
```cycle-report
{
  "session_id":   "fs-2026-05-26-001",
  "cycle":        3,
  "task_plan":    "task_plan-platform-improvements.md",
  "atomic_task":  "Task 5.1 — /api/health/cron route",
  "branch":       "claude/feature-shipper/fs-2026-05-26-001-c3",
  "worktree":     ".claude/worktrees/fs-2026-05-26-001-c3",
  "pr_url":       "https://github.com/pinnacleadvisors/nexus/pull/341",
  "pr_status":    "draft",
  "checks_run":   ["tsc","retry-storm","topology","provider-agnostic","cron-route","agent-spec-freshness","sentry-config"],
  "checks_green": true,
  "lines_changed": 312,
  "cost_usd_est":  0.85,
  "plan_window_share_pct_est": 4.5,
  "next_proposal": {
    "scope":        "continue",
    "task_plan":    "task_plan-platform-improvements.md",
    "atomic_task":  "Task 5.2 — /manage-platform health panel",
    "rationale":    "5.1 ships the API; 5.2 wires UI. Natural pair, < 200 LOC."
  },
  "stop_signals": [],
  "manual_tasks": []
}
```
```

When the agent emits `next_proposal.scope: "stop"`, the operator's UI surfaces "End shipper session" instead of "Continue" — and the agent ends its turn.

### Stop signals (any one triggers `scope: "stop"`)

Mirrors the v14 atom on "honest stopping":

- `speculative-task` — the next atomic task in the plan requires choices only the operator can make
- `requires-operator-approval` — proceeding would cross an explicit approval gate
- `pure-polish` — diminishing returns on a small UX nit
- `needs-real-data` — verification impossible without production state the agent can't access
- `cost-cap-approached` — sessionSharePct ≥ 90% of plan-window OR USD ≥ 90% of daily cap
- `two-zero-signal-cycles` — two consecutive cycles produced 0 net-new shippable signal
- `mergeable-pile-deep` — operator has > 5 open PRs from this shipper in the same plan family

---

## Schema — S2

One table. The cycles list IS the agent's state machine; everything else can be re-derived from git + PR state.

```sql
-- 070_feature_shipper_cycles.sql — one row per cycle attempt.
create table public.feature_shipper_cycles (
  id              uuid primary key default uuid_generate_v4(),
  user_id         text not null,
  session_id      text not null,
  cycle           integer not null,
  -- The plan + atomic task this cycle attempted.
  task_plan       text not null,
  atomic_task     text not null,
  -- Worktree + branch lifecycle.
  worktree_path   text not null,
  branch          text not null,
  -- PR outcome (null when cycle is still in-flight).
  pr_url          text,
  pr_status       text check (pr_status in ('draft','ready','merged','closed','failed') or pr_status is null),
  -- Check outcomes — flat list since the set evolves.
  checks_run      text[] not null default array[]::text[],
  checks_green    boolean,
  -- Cost + budget telemetry.
  lines_changed   integer,
  cost_usd        numeric(8,4),
  plan_window_share_pct numeric(6,3),
  -- Stop signals raised during the cycle (informational; cycle still proceeds).
  stop_signals    text[] not null default array[]::text[],
  -- Manual tasks emitted (operator inbox items).
  manual_tasks    jsonb not null default '[]'::jsonb,
  -- Lifecycle timestamps.
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  -- Free-form notes from the agent (rationale, blockers).
  notes           text
);

create index feature_shipper_cycles_session_idx
  on public.feature_shipper_cycles (session_id, cycle desc);
create index feature_shipper_cycles_user_idx
  on public.feature_shipper_cycles (user_id, started_at desc)
  where finished_at is null;

-- RLS: operator sees their own cycles only.
alter table public.feature_shipper_cycles enable row level security;
create policy "operator reads own cycles" on public.feature_shipper_cycles
  for select using (auth.uid()::text = user_id);
create policy "service writes" on public.feature_shipper_cycles
  for insert with check (true);
create policy "service updates" on public.feature_shipper_cycles
  for update using (true);

comment on table public.feature_shipper_cycles is
  'One row per attempted cycle of the feature-shipper-loop agent. The cycles list IS the agent state machine; everything else (git, PRs, checks) is derived state.';
```

---

## API — S3

Three endpoints. Mirrors the shape of `bug-hunt-loop`'s S3 design but simpler (no PR-merging logic — every PR is draft and stays draft).

| Endpoint | Body | Behaviour |
|---|---|---|
| `POST /api/feature-shipper/start` | `{ task_plan: string }` | Allocates a `session_id`, validates the plan exists, kicks the first cycle. Returns `{ session_id, cycle: 1, worktree, branch }`. |
| `POST /api/feature-shipper/cycle` | `{ session_id, action: "continue" \| "stop" \| "amend", amendments?: object }` | Records the operator's approval of the cycle-report. If `continue`, kicks the next cycle. If `stop`, marks the session terminated. If `amend`, modifies the next atomic task before running. |
| `GET  /api/feature-shipper/sessions` | — | Lists the operator's sessions + open cycles. |

Auth: `ALLOWED_USER_IDS` gate + Clerk session. Same shape as `/api/bug-hunt/*`.

---

## Worktree primitive — S5

Reuses the existing `.claude/worktrees/<name>` pattern. The helper at `lib/worktrees/spawn.ts`:

```typescript
export interface WorktreeSpec {
  sessionId: string
  cycle:     number
  baseBranch: string  // typically 'main'
}

export interface WorktreeHandle {
  path:    string  // absolute path
  branch:  string  // e.g. claude/feature-shipper/<sessionId>-c<cycle>
  cleanup: () => Promise<void>
}

export async function spawnWorktree(spec: WorktreeSpec): Promise<WorktreeHandle>
```

The worktree is created off the latest `origin/main` (fetched at spawn time). Cleanup removes the worktree directory + deletes the local branch if not pushed. If pushed, cleanup leaves the branch — the PR survives.

**Per-cycle isolation**: each cycle's worktree is independent. Cycle 3 of a session does NOT inherit cycle 2's worktree (cycle 2's PR is what carries forward; cycle 3 starts off main again or off cycle 2's branch if stacking is required).

---

## Mergeability auditor — S6

Implements the stacked-PR collision detection from the 2026-05-26 session. After each cycle's PR opens (and at session end), the auditor:

1. Lists every open PR opened by this shipper session.
2. For each, queries `gh pr view --json mergeable,mergeStateStatus`.
3. If any `mergeable: "CONFLICTING"`, runs the recovery from CLAUDE.md → "Default recovery for stacked-PR branches whose parents merged":
   - Identify the unique commit on the conflicting branch (the cycle's own commit).
   - `git fetch origin main`
   - `git checkout <branch> && git reset --hard origin/main && git cherry-pick <unique-sha> && git push --force-with-lease`
4. If recovery succeeds, re-poll mergeable status.
5. If recovery fails, flag the cycle's notes with the failure and surface the PR in the next `cycle-report`.

The auditor itself runs as a separate step in each cycle — it is NOT inlined into the agent's main loop, so a flaky audit doesn't take down a successful cycle.

---

## Cost guard + termination — S7

Cost gates:

- **Per-dispatch**: every gateway call goes through `assertUnderCostCap()` (existing primitive in `lib/cost-guard.ts`). Hard fail at `USER_DAILY_USD_LIMIT`.
- **Per-cycle**: cycle-report includes `cost_usd_est`. If the running sum across the session exceeds `FEATURE_SHIPPER_SESSION_USD_CAP` (default $5, env-tunable), the cycle-report's `next_proposal.scope` flips to `"stop"`.
- **Per-window**: tracks `plan_window_share_pct` across cycles; ≥ 25% of the 5h Claude Max window triggers stop.

Termination heuristic (any one stops the session):

1. Operator explicitly stops (`/api/feature-shipper/cycle` with `action: "stop"`)
2. Two consecutive cycles emit `next_proposal.scope: "stop"` with `stop_signals` non-empty
3. Cost cap tripped
4. Plan exhausted (next atomic task can't be identified — agent emits a `cycle-report` with `next_proposal: null`)

---

## UI — S4

A new view in the chat Views dropdown labeled "Feature shipper". Three panels:

1. **Active session card** — session_id, current cycle, plan, atomic task, ETA, live cost / plan-window meter, "Stop" button.
2. **Cycle log** — chronological list of cycle-reports for this session. Each row: cycle #, atomic task, PR link with mergeable badge, checks-green ✓/✗, lines, cost.
3. **Open PRs from this shipper** — separate list (matches by PR `feature-shipper-<session>` label). Each row: PR link, mergeable status, "Re-audit" button.

Mirrors the `bug-hunt-loop` UI surface — same row primitive, different domain.

---

## Operator UX — full flow

1. Operator types `/ship-feature task_plan-platform-improvements.md` in `/manage-platform` chat.
2. Agent emits a one-shot **session-plan** block summarising:
   - Which atomic task it will tackle first
   - Estimated total cycles to finish the plan (best guess)
   - Estimated total cost + plan-window share
3. Operator clicks Approve.
4. Agent spawns worktree, picks atomic task, implements, runs checks, opens draft PR.
5. Agent emits `cycle-report` block with `next_proposal`.
6. Operator clicks Continue / Stop / Amend.
7. Repeat until session terminates.

The agent never asks the operator a clarifying question mid-cycle — if it discovers an ambiguity, it emits a `manual-task` block and proceeds with the most defensible default, noting the choice in the cycle-report.

---

## What the loop is NOT

- **Not an autonomous code-generator**: every PR is draft + operator reviews + merges manually. The agent ships PRs, not features.
- **Not multi-tenant**: each session is one operator, one repo, one plan slug. No cross-team coordination.
- **Not a planner**: the agent picks the next atomic task from an existing `task_plan-*.md`. It does NOT invent plans. To invent plans, use a different agent (`nexus-architect`).
- **Not a refactorer**: each PR ships ONE atomic task. No surrounding cleanup, no "while I was here" changes. (The brief's "Three similar lines is better than a premature abstraction" rule applies.)

---

## Cost estimate per cycle

Rough envelope:

- 1× plan-reading turn (cheap — 1 file read)
- 1× implementation turn (medium — file edits, code generation)
- 1× test-writing turn (medium)
- 1× check-running turn (cheap — Bash invocations)
- 1× PR-opening turn (cheap — gh command)
- 1× mergeability-audit turn (cheap)

Estimated: 0.40–1.20 USD per cycle (sonnet pricing). 5-cycle session: 2–6 USD. Sits comfortably under the default 25 USD daily cap and well under any prudent session-cap.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Agent loops on a flaky check (e.g. flaky sentry-config network probe) | After 2 failed check runs on the same cycle, agent emits `manual-task` instead of retrying |
| Agent ships a PR that breaks tests in main | All PRs are draft; CI catches before merge. Operator reviews the diff. |
| Agent picks a task that needs operator input | `speculative-task` stop signal surfaces; agent emits `manual-task` and ends cycle |
| Worktree pile-up if cleanup fails | Daily cron sweeps `.claude/worktrees/fs-*` older than 7 days (existing nightly sweep extends easily) |
| Stacked-PR collisions | S6 auditor handles via reset+cherry-pick recovery; if recovery fails, surfaces in cycle-report |
| Cost runaway from a hung sandbox session | Per-call timeout already enforced by `lib/cost-guard.ts`; session-cap stops further cycles |
| Operator forgets the loop is running | Daily Slack digest of open shipper sessions (reuses cron-health alert plumbing) |

---

## When this plan is done

Operator's signoff on this plan PR. Implementation PRs (S1 + S5 + S6 first, then S2 + S3 + S4, then S7) ship after. Estimated total impl: 2–3 follow-up PRs, each under 500 LOC.

If the operator wants different framing (e.g. agent operates only on a single named plan, never spans plans) — say so before approval and I'll re-spec.
