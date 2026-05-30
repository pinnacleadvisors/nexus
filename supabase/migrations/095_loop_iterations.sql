-- 095_loop_iterations — per-iteration state + history for a Loop.
--
-- One row per iteration of a Loop (migration 094). Written by:
--   - POST /api/loops/[id]/start            → inserts the first row (outcome='running')
--   - POST /api/loops/[id]/iteration-result → resolves the running row + inserts the next
--
-- The loop-runner agent emits an `iteration-plan` typed block per cycle
-- (parsed by lib/chat/iteration-plan.ts); its approval_id is stored here as
-- iteration_plan_id so the dashboard can correlate the rendered approval card
-- with the persisted iteration. gateway_turn_ids back-links the spend rows
-- (gateway_turns.loop_id also carries the loop_id — migration 096).
--
-- Idempotent. RLS: service-role only.

create extension if not exists "uuid-ossp";

create table if not exists public.loop_iterations (
  id                 uuid          primary key default uuid_generate_v4(),
  loop_id            uuid          not null references public.loops(id) on delete cascade,

  -- 1-based iteration counter within the Loop.
  iteration_n        integer       not null,

  -- The iteration-plan typed-block approval_id (e.g. "loop-<id>-i3"). Lets the
  -- dashboard render the matching ApprovalCard against this row.
  iteration_plan_id  text,

  -- Snapshot of the iteration's declared scope + intent (from the
  -- iteration-plan block) so history reads standalone without re-parsing chat.
  scope              text,
  intent             text,

  started_at         timestamptz   not null default now(),
  ended_at           timestamptz,

  -- running = in flight; resolved to one of the terminal outcomes by the
  -- iteration-result callback.
  outcome            text          not null default 'running',

  summary_md         text,

  -- Back-links to the gateway_turns rows this iteration produced.
  gateway_turn_ids   text[]        not null default '{}',

  -- USD spend attributed to this iteration (0 on flat-fee plans; the loop's
  -- cost_cap is a fallback used on the anthropic-api plan, same as today).
  cost_usd           numeric(10,4) not null default 0.0000,

  constraint loop_iterations_outcome_check
    check (outcome in ('running', 'success', 'partial', 'error', 'cancelled'))
);

-- "every iteration of this Loop, in order" — the dashboard's iteration log.
create index if not exists loop_iterations_loop_idx
  on public.loop_iterations (loop_id, iteration_n);

-- "the currently-running iteration for this Loop" (resolve-on-callback path).
create index if not exists loop_iterations_running_idx
  on public.loop_iterations (loop_id)
  where outcome = 'running';

-- One row per (loop, iteration_n) — guards against a double-start race.
create unique index if not exists loop_iterations_loop_n_uniq
  on public.loop_iterations (loop_id, iteration_n);

alter table public.loop_iterations enable row level security;

drop policy if exists loop_iterations_service_role on public.loop_iterations;
create policy loop_iterations_service_role
  on public.loop_iterations
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

comment on table public.loop_iterations is
  'Per-iteration state + history for a Loop (migration 094). One row per '
  'iteration; outcome resolves running → success/partial/error/cancelled via '
  'the /api/loops/[id]/iteration-result callback. task_plan-loops-sprints.md.';
