-- 063_custom_org_chart — Part 4 of task_plan-departments-and-ecosystems.md, v1.
--
-- Adds the durable spine for custom org-chart arrangement:
--   teams.parent_team_id           — inter-department reporting (org tree)
--   teams.expires_at               — time-bounded teams (auto-archive on cron later)
--   teams.template_id              — links a team back to the org_templates row it was spawned from
--   team_members.borrowed_from_team_id  — cross-department role borrowing
--   team_members.tool_budget_override   — operator-forced tool selection per role
--   departments_custom             — operator-created departments beyond the 7 starters
--   org_templates                  — save-as-template for repeatable arrangements
--
-- v1 ships the SCHEMA. UI for org-chart visualisation + custom-dept creation
-- ships in this PR. UI for tool-budget overrides + template save/load is a
-- follow-up — schema readiness keeps follow-ups mechanical.
--
-- All statements idempotent.

create extension if not exists "uuid-ossp";

create table if not exists public.org_templates (
  id            uuid          primary key default uuid_generate_v4(),
  user_id       text          not null,
  name          text          not null,
  niche         text,                                          -- when set, this template is the default for the niche
  blueprint     jsonb         not null,                        -- shape: { teams: [{ department, ecosystem_bindings, parent_idx }, ...] }
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now(),

  constraint org_templates_name_per_user_unique unique (user_id, name)
);

create index if not exists org_templates_user_idx on public.org_templates (user_id);
create index if not exists org_templates_niche_idx on public.org_templates (niche) where niche is not null;

create table if not exists public.departments_custom (
  id            uuid          primary key default uuid_generate_v4(),
  user_id       text          not null,
  slug          text          not null,
  label         text          not null,
  purpose       text          not null,
  roles         text[]        not null default '{}'::text[],
  default_ecosystem_kinds text[] not null default '{}'::text[],
  approval_gates text[]       not null default '{}'::text[],
  created_at    timestamptz   not null default now(),

  constraint departments_custom_slug_per_user_unique unique (user_id, slug)
);

create index if not exists departments_custom_user_idx on public.departments_custom (user_id);

alter table public.teams
  add column if not exists parent_team_id  uuid references public.teams(id) on delete set null,
  add column if not exists expires_at      timestamptz,
  add column if not exists template_id     uuid references public.org_templates(id) on delete set null;

create index if not exists teams_parent_idx on public.teams (parent_team_id) where parent_team_id is not null;
create index if not exists teams_expires_idx on public.teams (expires_at) where expires_at is not null;

alter table public.team_members
  add column if not exists borrowed_from_team_id   uuid references public.teams(id) on delete set null,
  add column if not exists tool_budget_override    text[];

alter table public.org_templates        enable row level security;
alter table public.departments_custom   enable row level security;

drop policy if exists org_templates_service_role_all on public.org_templates;
create policy org_templates_service_role_all
  on public.org_templates for all
  using  (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists departments_custom_service_role_all on public.departments_custom;
create policy departments_custom_service_role_all
  on public.departments_custom for all
  using  (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
