-- 097_sub_harnesses — reusable harness artifacts crystallized by synthesize Loops.
--
-- A "sub-harness" is the durable NOUN a mode=synthesize Loop (migration 094,
-- loops.mode) produces for a goal never achieved before: a bundle of skills +
-- agent refs + a tool/MCP manifest + self-authored tests + a typed review-spec.
-- Maps to Life-Harness `h5` (procedural skill) — but COMPOSITE (many skills)
-- vs skill-trainer's single-skill SKILL.md output. Once verified, it's
-- replayable directly (POST /api/sub-harnesses/[slug]/invoke) — no
-- re-exploration.
--
-- Lifecycle: draft (written by the synthesize Loop + a Board card for review)
--   → verified (human flips it via /api/sub-harnesses/[slug]/promote, same gate
--     as the skill router) → replayable. failed = exploration exhausted caps
--   without passing verification.
--
-- loop_id is nullable + ON DELETE SET NULL: the producing Loop may be killed
-- later; the artifact it crystallized outlives it.
--
-- Idempotent. RLS service-role only.

create extension if not exists "uuid-ossp";

create table if not exists public.sub_harnesses (
  id           uuid          primary key default uuid_generate_v4(),
  loop_id      uuid          references public.loops(id) on delete set null,
  user_id      text          not null,

  slug         text          not null,
  goal_md      text          not null default '',

  -- { skills[]: string[], agent_refs[]: string[], tools[]: string[],
  --   tests[]: {name, command?, assert?, passed?}, review_spec: {modality, criteria[]} }
  manifest     jsonb         not null default '{}'::jsonb,

  status       text          not null default 'draft',

  created_at   timestamptz   not null default now(),
  verified_at  timestamptz,
  verified_by  text,

  constraint sub_harnesses_status_check
    check (status in ('draft', 'verified', 'failed'))
);

-- One harness per (user, slug) — invoke-by-slug must resolve uniquely.
create unique index if not exists sub_harnesses_user_slug_uniq
  on public.sub_harnesses (user_id, slug);

-- List view: "every harness this operator owns, by status, newest first."
create index if not exists sub_harnesses_user_status_idx
  on public.sub_harnesses (user_id, status, created_at desc);

-- "every harness produced by this Loop."
create index if not exists sub_harnesses_loop_idx
  on public.sub_harnesses (loop_id)
  where loop_id is not null;

alter table public.sub_harnesses enable row level security;

drop policy if exists sub_harnesses_service_role on public.sub_harnesses;
create policy sub_harnesses_service_role
  on public.sub_harnesses
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

comment on table public.sub_harnesses is
  'Reusable composite harness artifacts (h5) crystallized by mode=synthesize '
  'Loops. draft → verified (human promote gate) → replayable via '
  '/api/sub-harnesses/[slug]/invoke. task_plan-loops-sprints.md v2.';
