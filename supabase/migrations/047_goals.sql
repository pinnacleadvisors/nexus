-- 047_goals.sql
--
-- Phase 2 (Paperclip absorption) — first-class company goals.
--
-- See: docs/research/paperclip-audit-2026-05.md §2-§3 (goal hierarchy)
--      docs/adr/007-paperclip-absorption.md
--      task_plan-paperclip-absorption.md (Task 2b)
--
-- Goals are standalone entities; issues cross-link via issues.goal_id (added
-- in migration 048). Paperclip's full 5-level hierarchy (Initiative →
-- Project → Milestone → Issue → Sub-issue) is deliberately collapsed to
-- "goals + issues with parent_id" per audit §3 — pragmatic minimum that
-- preserves the "all work traces to goal" property without 5 new tables.
-- Future expansion to Initiative/Project/Milestone deferred to a later phase.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; CREATE INDEX IF NOT EXISTS.
--
-- Paired helper: lib/goals/insert.ts handles the missing-table state
-- gracefully (returns {error: null} + logs once) so app code keeps working
-- pre-migration.

create table if not exists goals (
  id                uuid           primary key default gen_random_uuid(),
  business_slug     text           not null
                                   references business_operators(slug) on delete cascade,
  title             text           not null,
  success_criteria  text           null,                            -- bullet list, markdown
  parent_goal_id    uuid           null
                                   references goals(id) on delete set null,
  status            text           not null default 'active'
                                   check (status in ('active','completed','cancelled','archived')),
  created_at        timestamptz    not null default now(),
  updated_at        timestamptz    not null default now()
);

create index if not exists goals_business_slug_idx
  on goals(business_slug);
create index if not exists goals_parent_idx
  on goals(parent_goal_id)
  where parent_goal_id is not null;

-- updated_at trigger
create or replace function goals_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists goals_updated_at on goals;
create trigger goals_updated_at
  before update on goals
  for each row execute function goals_set_updated_at();

alter table goals enable row level security;

drop policy if exists goals_service_role_all on goals;
create policy goals_service_role_all on goals
  for all using (true) with check (true);

comment on table goals is
  'Company-level goals (the "why" chain). issues.goal_id cross-links work back to a goal; goals can nest via parent_goal_id. Per ADR-007 / Paperclip absorption.';
comment on column goals.business_slug is
  'Partition key. Every goal belongs to exactly one business_operator. Matches the cross-table partition convention.';
comment on column goals.parent_goal_id is
  'Optional parent for sub-goals. Self-FK with ON DELETE SET NULL so deleting a parent does not orphan children semantically — they remain as top-level goals.';
comment on column goals.success_criteria is
  'Free-text markdown bullet list. Surfaced in dispatch prompts so agents can self-evaluate against measurable outcomes.';
