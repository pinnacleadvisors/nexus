-- 060_teams — departments-as-teams + their member rosters.
--
-- See task_plan-departments-and-ecosystems.md for the architecture.
-- A `team` is a department instance bound to one business (or null =
-- admin scope). `team_members` carries one row per role; each row holds
-- the spec path the per-business container should mount and the v1 tool
-- budget (≥ 2 entries per the AGENTS.md rule).
--
-- Future migration adds: parent_team_id, expires_at, template_id (custom
-- org-chart arrangement). v1 keeps the schema minimal so the abstraction
-- ships without locking us into shape choices we haven't validated.
--
-- All statements idempotent.

create extension if not exists "uuid-ossp";

create table if not exists public.teams (
  id                  uuid          primary key default uuid_generate_v4(),
  user_id             text          not null,
  business_slug       text,                                    -- null = admin scope
  department_slug     text          not null,
  status              text          not null default 'active',
  ecosystem_bindings  jsonb         not null default '{}'::jsonb,
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now(),

  constraint teams_status_check
    check (status in ('active', 'paused', 'archived'))
);

create index if not exists teams_user_business_idx
  on public.teams (user_id, business_slug, status);

create index if not exists teams_department_idx
  on public.teams (user_id, department_slug, status);

create table if not exists public.team_members (
  id                  uuid          primary key default uuid_generate_v4(),
  team_id             uuid          not null references public.teams(id) on delete cascade,
  role_slug           text          not null,
  agent_spec_path     text,                                    -- .claude/agents/departments/<dept>/<role>.md
  ecosystem_overrides jsonb         not null default '{}'::jsonb,
  tool_budget         text[]        not null default '{}'::text[],
  created_at          timestamptz   not null default now(),

  constraint team_members_role_per_team_unique unique (team_id, role_slug)
);

create index if not exists team_members_team_idx
  on public.team_members (team_id);

alter table public.teams         enable row level security;
alter table public.team_members  enable row level security;

drop policy if exists teams_service_role_all on public.teams;
create policy teams_service_role_all
  on public.teams for all
  using  (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists team_members_service_role_all on public.team_members;
create policy team_members_service_role_all
  on public.team_members for all
  using  (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
