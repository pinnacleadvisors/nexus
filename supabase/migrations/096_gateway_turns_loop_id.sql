-- 096_gateway_turns_loop_id — attribute gateway spend to a parent Loop.
--
-- Each Loop iteration creates ≥1 gateway turn (the loop-runner dispatch +
-- any explorer/verifier sub-dispatches in synthesize mode). Adding loop_id
-- lets the Loop dashboard sum spend per Loop directly from gateway_turns
-- (the authoritative accounting table) without a join through
-- loop_iterations.gateway_turn_ids.
--
-- Nullable + ON DELETE SET NULL: the vast majority of turns are not
-- Loop-scoped (chat, bug-hunt, business ticks); killing a Loop must not
-- delete its historical accounting rows.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS) — re-run is a no-op.

alter table public.gateway_turns
  add column if not exists loop_id uuid references public.loops(id) on delete set null;

-- "what did this Loop spend across all its iterations?" — dashboard cost sum.
create index if not exists gateway_turns_loop_idx
  on public.gateway_turns (loop_id, created_at desc)
  where loop_id is not null;

comment on column public.gateway_turns.loop_id is
  'When set, this turn was spawned by a Loop (migration 094). Lets the Loop '
  'dashboard attribute spend per Loop. Null for non-Loop turns. '
  'task_plan-loops-sprints.md.';
