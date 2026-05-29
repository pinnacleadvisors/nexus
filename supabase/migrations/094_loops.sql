-- 094_loops — the operator-configurable iteration framework ("Loops").
--
-- A Loop is the operator's own version of the business-operator cyclic
-- pattern: declare a North Star + end-outcome predicate + a delegated agent,
-- set cost/iteration/time caps + approval gates, and the platform runs an
-- iteration loop within those bounds. Loops dispatch the `loop-runner` agent
-- through the EXISTING claude-gateway — no new runtime, no autonomous
-- spawning (this table is the sole source of truth for what may fire).
--
-- Maps to Life-Harness `h4` (trajectory regulation) — see AGENTS.md
-- "Harness taxonomy". Inherits every Ralph-loop invariant.
--
-- v2 (harness synthesis) columns are FOLDED IN here with `iterate` defaults
-- rather than a later ALTER — a v1 row is simply a Loop with mode='iterate'
-- and null explorer/verifier models. See task_plan-loops-sprints.md.
--
-- Consumed by:
--   - app/api/loops/*           (CRUD + start + iteration-result)
--   - app/(protected)/settings/loops/*  (list / new / dashboard)
--   - .claude/agents/loop-runner.md     (the dispatched agent)
--   - loop_iterations (migration 095) FK → loops(id)
--   - gateway_turns.loop_id (migration 096) attributes spend per Loop
--
-- Idempotent (IF NOT EXISTS). RLS: service-role only (same single-owner
-- pattern as gateway_turns / operator_tasks — API routes use the service
-- client; direct anon/authenticated reads disallowed).

create extension if not exists "uuid-ossp";

create table if not exists public.loops (
  id                    uuid          primary key default uuid_generate_v4(),
  user_id               text          not null,

  -- Nullable: platform-wide Loops (operator iterating on Nexus itself) have
  -- no business. Per-business Loops set this so spend attributes correctly
  -- and checkKillSwitch(business_slug) can gate dispatch.
  business_slug         text,

  name                  text          not null,

  -- The three declarative anchors (Step 0 North Star shape).
  north_star_md         text          not null default '',
  end_outcome_md        text          not null default '',

  -- The agent the platform dispatches each iteration against. Resolved from
  -- .claude/agents/<slug>.md / agent_library. delegated_team_id is reserved
  -- for team-scoped Loops (materialiseTeam) — nullable until that lands.
  delegated_agent_slug  text          not null,
  delegated_team_id     uuid,

  -- Bounds. All nullable = "no cap on this axis" (at least one SHOULD be set;
  -- the API warns but does not hard-reject so an open-ended exploratory Loop
  -- is still expressible). cost_cap_usd is enforced via checkKillSwitch +
  -- assertUnderCostCap per dispatch, same machinery as today.
  cost_cap_usd          numeric(10,4),
  iteration_cap         integer,
  time_cap_hours        numeric(8,2),

  -- Gate keys (e.g. ["deploy_to_prod","niche_pick"]) whose scope changes
  -- require operator approval. Mirrors business_operators.approval_gates.
  approval_gates        jsonb         not null default '[]'::jsonb,

  status                text          not null default 'active',

  -- ── v2: harness synthesis (folded in, iterate defaults) ─────────────────
  -- iterate  = v1 "iterate against a moving target".
  -- synthesize = v2 "crystallize a reusable sub-harness for a novel goal".
  mode                  text          not null default 'iterate',
  -- Cheap/fast model that does the exhaustive strategy search AND writes +
  -- runs its own tests in nexus-sandbox (e.g. a codex / haiku tier).
  explorer_model        text,
  -- Expensive/smart model invoked ONLY after the explorer produces passing
  -- test evidence (TDD-evidence-before-review). Judges the assembled harness.
  verifier_model        text,
  -- vision | audio | code | text — selects a modality-appropriate verifier.
  review_modality       text,

  created_at            timestamptz   not null default now(),
  ended_at              timestamptz,

  constraint loops_status_check
    check (status in ('active', 'paused', 'done', 'killed')),
  constraint loops_mode_check
    check (mode in ('iterate', 'synthesize')),
  constraint loops_review_modality_check
    check (review_modality is null or review_modality in ('vision', 'audio', 'code', 'text'))
);

-- List view: "every Loop this operator owns, newest first."
create index if not exists loops_user_status_idx
  on public.loops (user_id, status, created_at desc);

-- Per-business slice: "every Loop for this business."
create index if not exists loops_business_idx
  on public.loops (business_slug, created_at desc)
  where business_slug is not null;

alter table public.loops enable row level security;

drop policy if exists loops_service_role on public.loops;
create policy loops_service_role
  on public.loops
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

comment on table public.loops is
  'Operator-declared iteration framework (Loops). One row per declared Loop. '
  'Dispatches loop-runner through claude-gateway within cost/iteration/time '
  'caps. Sole source of truth for what may fire — no autonomous spawning. '
  'task_plan-loops-sprints.md.';
comment on column public.loops.mode is
  'iterate (v1, iterate against a moving target) | synthesize (v2, crystallize '
  'a reusable sub-harness for a novel goal via two-tier explorer→verifier).';
