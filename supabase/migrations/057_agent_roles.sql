-- 057_agent_roles.sql
--
-- Org-chart orchestration — assign AI agents (or humans) to named roles with
-- reporting lines. Surfaces at /org as an interactive hierarchy.
--
-- See: task_plan-platform-expansion.md (Task C)
--      docs/research/paperclip-audit-2026-05.md §4 (role orchestration)
--      .claude/agents/* (assignable agent slugs)
--      lib/org/roles.ts (graceful-degrade insert helper)
--
-- Schema invariants:
--   * role_title is free-form (CEO, CTO, "Email Marketing Lead", …) — no
--     enum so the operator can model their own org without a migration.
--   * parent_role_id is a self-FK with ON DELETE SET NULL — deleting a parent
--     does not orphan children semantically; they remain as top-level roles.
--   * assigned_agent_slug is a soft reference to agent_library.slug. Not an
--     FK because agent_library rows can be regenerated and we don't want a
--     spec rebuild to cascade-null every assignment.
--   * business_slug is nullable — NULL means "platform-level" (a CEO across
--     all businesses); non-NULL scopes to one business (a CMO for inkbound).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; CREATE INDEX IF NOT EXISTS;
-- DROP POLICY IF EXISTS / CREATE POLICY.
--
-- Paired helper: lib/org/roles.ts (graceful-degrade insert/list/getTree).

create table if not exists agent_roles (
  id                    uuid           primary key default gen_random_uuid(),
  business_slug         text           null
                                       references business_operators(slug) on delete cascade,
  role_title            text           not null,
  parent_role_id        uuid           null
                                       references agent_roles(id) on delete set null,
  assigned_agent_slug   text           null,                 -- soft ref to agent_library.slug
  assigned_user_id      text           null,                 -- soft ref to Clerk user_id (operator owns a role manually)
  responsibilities      text           null,                 -- markdown bullets
  reports_to_summary    text           null,                 -- denormalised "Reports to CEO" string, kept in sync at app layer
  sort_order            integer        not null default 0,   -- sibling ordering within a parent
  created_at            timestamptz    not null default now(),
  updated_at            timestamptz    not null default now(),

  -- Single-assignee invariant: either an agent OR a user, never both.
  constraint agent_roles_single_assignee
    check (
      (assigned_agent_slug is null and assigned_user_id is null) or
      (assigned_agent_slug is not null and assigned_user_id is null) or
      (assigned_agent_slug is null and assigned_user_id is not null)
    )
);

create index if not exists agent_roles_business_idx
  on agent_roles(business_slug);
create index if not exists agent_roles_parent_idx
  on agent_roles(parent_role_id)
  where parent_role_id is not null;
create index if not exists agent_roles_agent_idx
  on agent_roles(assigned_agent_slug)
  where assigned_agent_slug is not null;

create or replace function agent_roles_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists agent_roles_updated_at on agent_roles;
create trigger agent_roles_updated_at
  before update on agent_roles
  for each row execute function agent_roles_set_updated_at();

alter table agent_roles enable row level security;

drop policy if exists agent_roles_service_role_all on agent_roles;
create policy agent_roles_service_role_all on agent_roles
  for all using (true) with check (true);

comment on table agent_roles is
  'Org-chart roles. Each role can be assigned to one agent (slug) or one user (Clerk id). Hierarchical via parent_role_id. business_slug NULL = platform-level role; non-NULL = scoped to one business. See task_plan-platform-expansion.md Task C.';
comment on column agent_roles.assigned_agent_slug is
  'Soft reference to agent_library.slug. NULL = unassigned (slot exists, no one is filling it).';
comment on column agent_roles.parent_role_id is
  'Self-FK with ON DELETE SET NULL — deleting a parent promotes children to top-level rather than cascading. Mirrors goals.parent_goal_id behaviour.';
comment on column agent_roles.sort_order is
  'Sibling order within a parent. Default 0 places new roles at the start; the UI assigns explicit values via drag-and-drop.';
