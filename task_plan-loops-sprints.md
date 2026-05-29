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

## v2 — Harness synthesis (operator brain-dump 2026-05-28 absorption)

> Layered ON TOP of v1. v1 (the Loop *engine* — Groups A–D above) ships
> first, unchanged. v2 adds the ability for a Loop to *synthesize a
> reusable sub-harness* for a goal that's never been achieved before.
> Gated on v1 landing + operator approval of this section.

### The three-tier mental model (resolves the "is a Loop a sub-harness?" question)

- **Master harness = Nexus** — the orchestration layer (gateways, adapter
  registry, dispatch). Maps to Life-Harness `h2`/`h3` (see AGENTS.md
  "Harness taxonomy"). This is the orchestrator the operator hands a goal to.
- **Loop = the iteration *runtime*** (the verb) — bounded, operator-declared,
  cost/iteration/time-capped, gated. Maps to `h4` (trajectory regulation).
- **Sub-harness = the reusable *artifact*** (the noun) a Loop crystallizes
  for a novel goal — a folder bundling skills + agent refs + tool/MCP
  manifest + self-authored tests + a typed review-spec. Maps to `h5`
  (procedural skill), but *composite* (many skills) vs skill-trainer's
  single-skill output. Replayable directly once verified — no re-exploration.

A Loop does NOT get renamed to "sub-harness". A Loop in `mode: synthesize`
*produces* a sub-harness; replaying a promoted sub-harness may need no Loop.

### What v2 reuses (do not rebuild)

| Brain-dump concept | Existing Nexus surface to extend |
|---|---|
| Closed propose→test→grade→retry ("skill labs") | `.claude/agents/skill-trainer.md` — the inner mechanism. v2's Loop is the OUTER multi-strategy explorer that calls skill-trainer per candidate skill. |
| "note failures akin to Hermes" + "tools/mcp in a folder" | skill-trainer's `SKILL.md` Error Remediation block + `supermemory` atom + `.claude/skills/<name>/`. |
| "fast exhaustive explorer → smart verifier" | claude-gateway (smart) + codex-gateway (fast) routing; `codex-maintainer` adversarial grader + `design-critic` gate are the precedent. NO new gateway. |
| "I review once smart model says production-ready" | draft→verified promote gate (`/api/skills/[slug]/promote` pattern), human flips on the Board. |

### What v2 adds (the genuinely new 30%)

```
### Task E1 — Loop `mode` column + sub_harnesses schema
- File:     supabase/migrations/0NN_sub_harnesses.sql  (use NEXT free number)
- Change:   ALTER loops ADD COLUMN mode text DEFAULT 'iterate'
            CHECK (mode IN ('iterate','synthesize')),
            ADD COLUMN explorer_model text NULL,   -- cheap/fast, exhaustive
            ADD COLUMN verifier_model text NULL,   -- expensive/smart, judges
            ADD COLUMN review_modality text NULL.  -- vision|audio|code|text
            NEW `sub_harnesses` table: id, loop_id FK, slug, goal_md,
            manifest jsonb (skills[], agent_refs[], tools[], tests[],
            review_spec), status (draft|verified|failed), created_at,
            verified_at, verified_by.
- Verify:   idempotent + RLS service-role.

### Task E2 — sub-harness artifact folder + manifest writer
- File:     .claude/sub-harnesses/<slug>/HARNESS.md (skeleton) + lib/harness/manifest.ts
- Change:   the synthesize-mode Loop writes a HARNESS.md (frontmatter:
            goal, skills, agent_refs, tools, tests, review_modality,
            status) + the winning strategy's execution steps + an
            Error Remediation log (mirrors skill-trainer's SKILL.md shape,
            but composite). Borrows Pi.dev's 4-core-tool minimalism — keep
            the bundle small + auditable.

### Task E3 — two-tier synthesize loop in loop-runner
- File:     .claude/agents/loop-runner.md (extend v1 spec)
- Change:   when mode=synthesize: (1) memory_search + scan .claude/skills
            for liftable prior art FIRST; (2) explorer_model proposes N
            strategies, each producing passing test evidence in the
            nexus-sandbox BEFORE any verifier spend (Pi.dev TDD-evidence
            discipline); (3) verifier_model reviews the assembled harness
            for functionality + quality, modality-aware (a vision deliverable
            gets a vision-capable verifier); (4) on pass, write the
            sub_harness as status:draft + Board card for human promote.
- Invariants: inherits ALL Ralph-loop rules (cost-cap via checkKillSwitch,
            draft-only, human final gate). explorer spend capped separately
            from verifier spend so a runaway exploration can't burn the
            smart-model budget.

### Task E4 — replay path
- File:     POST /api/sub-harnesses/[slug]/invoke
- Change:   run a verified sub-harness directly (fast path, no exploration).
            Refuses if status != verified (same gate as skill router).
```

### Pi.dev decision (build-vs-buy)

**Build on Nexus's substrate; borrow Pi.dev ideas, do not adopt its runtime.**
Pi.dev (`pi-harness`, Mario Zechner) is an open-source reshapeable
coding-agent harness — its `pi-agent-core` overlaps with what
claude-gateway/codex-gateway already do. Adopting it = a new gateway =
violates the v1 hard constraint. Absorb only: (a) 4-core-tool minimalism,
(b) skill-discovery-before-propose, (c) TDD-evidence-before-review.

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
