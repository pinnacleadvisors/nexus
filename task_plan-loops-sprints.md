# task_plan — Loops / Sprints (operator-configurable iteration framework)

> Operator brain-dump 2026-05-27. **STATUS: PLANNED, awaiting operator approval.**
> Per the [Long-Horizon Task Protocol](AGENTS.md), Phase 1 (explore) +
> Phase 2 (plan) are below; Phase 3 (implement) is gated on operator
> sign-off.

## North Star

```
Goal:             A first-class "Loop" / "Sprint" primitive that lets the
                  operator declare an end-outcome + a delegated agent /
                  team, and have the platform run an iteration loop until
                  the outcome is reached. Same shape as how an operator
                  ran `npm run dev` + Playwright + Claude in a session +
                  kept iterating until a feature was production-ready —
                  but configurable, viewable, and reproducible.
Success criteria: - Operator declares a Loop via /settings → Loops with:
                    - North Star (one paragraph)
                    - End-outcome predicate (description + acceptance test)
                    - Delegated agent or team
                    - Cost cap / iteration cap / time cap
                    - Approval gates (which scope changes need operator OK)
                  - Platform spawns the Loop, persists state per iteration,
                    surfaces a Loop dashboard with iteration log + cost +
                    pending approvals
                  - Operator can pause / resume / amend / kill any Loop
                  - Loop terminates when end-outcome predicate is met OR
                    cost/iteration cap is hit OR operator kills
                  - All iteration history persisted (via gateway_turns +
                    a new loop_iterations table)
Hard constraints: - Loops inherit every Ralph-loop invariant from AGENTS.md
                    (operator-gated kickoff, bounded items, draft PRs, no
                    auto-merge, cost-aware, memory atom on exit)
                  - No new runtimes, no new gateways — Loops dispatch
                    through the existing claude-gateway / codex-gateway
                  - No autonomous spawning — only operator-declared Loops
                    fire. The Loop config table is the source of truth;
                    nothing else can spawn a Loop
```

## Why this exists

Today, the operator runs ad-hoc iterations in chat sessions: "ship X, then
verify, then refine, then ship Y, then verify…". These iterations are
high-leverage but ephemeral — the platform doesn't know what the
"end-outcome" was, doesn't track cost across iterations, and the operator
has to re-frame the loop every session.

Loops formalise this as a first-class primitive:
- Operator declares an outcome + bound once
- Platform runs the loop within bounds
- Iteration log + cost + approvals are queryable + resumable
- Same loop can re-run later when conditions change

This is what `business-operator` (the autonomous cron-driven orchestrator)
already does for one business — but at a single-strategic-cycle cadence.
**Loops are the operator's own version of that pattern: declarative,
inspectable, configurable.**

## Phase 1 — explore (filesystem-verified 2026-05-27)

| Adjacent surface | Path | How Loops relates |
|---|---|---|
| business-operator agent | `.claude/agents/business-operator.md` | Already the canonical "run a cyclic loop on a single business" pattern. Loops generalise it. |
| Ralph loop protocol | AGENTS.md §"Operator-gated loop pattern" | Loops inherit every invariant — iteration-plan blocks, scope=stop, draft PRs only, etc. |
| bug-hunt-loop agent | `.claude/agents/bug-hunt-loop.md` | One specific Loop type. After this plan ships, bug-hunt becomes "the bug-hunt preset for the Loops primitive" rather than a one-off agent. |
| solopreneur-loop | `.claude/agents/solopreneur-loop.md` | The autonomous version. Both share the cost-guard + termination heuristic. |
| edit-plan / edit-self / iteration-plan blocks | `lib/chat/*.ts` | Loops emit these per iteration. Reuse the existing chat poll-route parser. |
| gateway_turns table | `supabase/migrations/039_gateway_turns.sql` | Each Loop iteration creates ≥1 gateway turn. Loops add a parent `loop_id` column to attribute spend. |

**Nothing prevents a Loops primitive — the substrate is in place.**

## Phase 2 — atomic tasks

### Group A — schema (~1 hour)

```
### Task A1 — Migration 086_loops.sql + 087_loop_iterations.sql
- File:     supabase/migrations/086_loops.sql, supabase/migrations/087_loop_iterations.sql
- Change:   `loops` table — id, user_id, business_slug (nullable for
            platform-wide loops), name, north_star_md, end_outcome_md,
            delegated_agent_slug, delegated_team_id (nullable),
            cost_cap_usd, iteration_cap, time_cap_hours, approval_gates
            jsonb, status (active/paused/done/killed), created_at,
            ended_at. `loop_iterations` — id, loop_id (FK), iteration_n,
            iteration_plan_id (the typed block id), started_at, ended_at,
            outcome (success/partial/error/cancelled), summary_md,
            gateway_turn_ids text[], cost_usd.
- Verify:   migrations idempotent + RLS service-role only.
- Parallel: no (foundation).

### Task A2 — gateway_turns.loop_id column
- File:     supabase/migrations/088_gateway_turns_loop_id.sql
- Change:   ALTER gateway_turns ADD COLUMN loop_id uuid NULL REFERENCES loops(id);
- Verify:   re-run is no-op (IF NOT EXISTS).
- Parallel: yes (after A1).
```

### Group B — API + persistence (~3-4 hours)

```
### Task B1 — POST /api/loops — create
- File:     app/api/loops/route.ts
- Change:   accepts {name, business_slug, north_star_md, end_outcome_md,
            delegated_agent_slug, cost_cap_usd, iteration_cap, time_cap_hours,
            approval_gates}. Validates. Inserts row. Returns id.
- Verify:   tsc + curl POST returns 200 with id.
- Parallel: yes.

### Task B2 — POST /api/loops/[id]/start — kick off first iteration
- Change:   dispatches the delegated_agent_slug through claude-gateway with
            inputs.tools[] budget + loop context (north star, end outcome,
            cost remaining). Persists initial loop_iteration row.
- Parallel: yes (after B1).

### Task B3 — POST /api/loops/[id]/iteration-result — append outcome
- Change:   called by the loop agent's chat poll route after each iteration.
            Writes loop_iterations row with outcome + summary + gateway_turn_ids.
            Returns next iteration's instruction (continue / stop / await-approval).
- Parallel: yes (after B1).

### Task B4 — PATCH /api/loops/[id] — pause/resume/kill/amend
- Change:   operator controls. status transitions + cost-cap adjustments.
- Parallel: yes (after B1).
```

### Group C — UI (~4-5 hours)

```
### Task C1 — /settings/loops list page
- File:     app/(protected)/settings/loops/page.tsx + components/loops/LoopsList.tsx
- Change:   list every Loop owned by the operator with status pill,
            iteration count, total cost, last activity.
- Parallel: yes (after B1).

### Task C2 — /settings/loops/new form
- File:     app/(protected)/settings/loops/new/page.tsx + components/loops/LoopForm.tsx
- Change:   form with: name, business (optional), north star (textarea),
            end-outcome predicate (textarea), delegated agent (dropdown
            from agent_library), caps, gates. Save → POST /api/loops.
- Parallel: yes (after B1).

### Task C3 — /settings/loops/[id] dashboard
- File:     app/(protected)/settings/loops/[id]/page.tsx + components/loops/LoopDashboard.tsx
- Change:   iteration log + cost graph + pending approvals + pause/resume
            buttons. Reuses ApprovalCard for any blocking approvals.
- Parallel: yes (after C1).
```

### Group D — agent spec (~1 hour)

```
### Task D1 — `loop-runner` agent spec
- File:     .claude/agents/loop-runner.md (new)
- Change:   the agent that the platform dispatches against when a Loop
            iteration fires. Reads the Loop config + iteration history,
            emits an iteration-plan block per cycle, calls back via the
            chat poll route on completion.
- Parallel: yes (after Group A + B done).
```

## Phase 3 — implement

Operator approves the plan first. Then ship in order: A → B → C → D. ~1 day of dev work in total.

## Cost model

The Loop primitive adds NO new cost — it's a layer on top of the existing
claude-gateway / codex-gateway dispatches. The `cost_cap_usd` field is
enforced via `checkKillSwitch(business_slug)` per dispatch, same as
today.

## Relationship to existing patterns

- **Plugins / skills** — Loops is a *primitive*, not a plugin. A specific
  Loop could be packaged as a plugin (e.g. "bug-hunt-loop preset", "feature-
  shipper-loop preset") but the primitive itself is in core.
- **Ralph loop pattern** (AGENTS.md) — Loops are the operator-declared,
  configurable, persistable version of the Ralph loop pattern. They
  inherit every invariant.
- **business-operator** — a Loop scoped to a business with the
  business-operator agent as `delegated_agent_slug` IS a business-operator
  cycle. Eventually business-operator becomes a built-in Loop preset.

## Progress

_Updated as work lands. Format: `## Progress (as of YYYY-MM-DD)` per CLAUDE.md._

### Awaiting operator approval
- [ ] Group A — schema (086 + 087 + 088 migrations)
- [ ] Group B — API endpoints
- [ ] Group C — UI (/settings/loops list + new + dashboard)
- [ ] Group D — `loop-runner` agent spec

### Blockers / Open questions
- **Naming** — "Loops" or "Sprints"? Operator brain-dump used both. Loops
  feels right for the open-ended "iterate until X" semantic; Sprints
  carries an Agile-team connotation that overlaps with /board's columns.
  Defaulting to "Loops" unless operator overrides.
- **Plugin packaging** — should Loop presets ship as `.claude/skills/loops/
  <preset>/SKILL.md` or as their own `.claude/loops/<preset>/LOOP.md`?
  Recommend: same dir as skills (single namespace) with a `kind: loop-preset`
  frontmatter field.
- **Approval-gate inheritance** — when a Loop dispatches an agent that
  emits its OWN approval-request, does it gate the Loop's iteration too
  or just queue alongside? Recommend: gate the iteration (Loop pauses
  until approved).
