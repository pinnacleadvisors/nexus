-- 008_agent_hierarchy.sql
-- Agent hierarchy extensions for Phase 16 Organisation Chart.
-- Adds parent/child relationships, layer classification, and utilisation
-- tracking to the existing agents table from migration 006_swarm.sql.

-- ── Extend agents table ───────────────────────────────────────────────────────
-- Add hierarchy columns if agents table exists (from 006_swarm.sql)
do $$ begin
  if exists (select 1 from information_schema.tables where table_name = 'agents') then

    -- Parent-child relationship
    if not exists (
      select 1 from information_schema.columns
      where table_name = 'agents' and column_name = 'parent_agent_id'
    ) then
      alter table agents add column parent_agent_id uuid references agents(id) on delete set null;
    end if;

    -- Hierarchy layer: 0=user, 1=strategic, 2=tactical, 3=specialist, 4=worker
    if not exists (
      select 1 from information_schema.columns
      where table_name = 'agents' and column_name = 'layer'
    ) then
      alter table agents add column layer integer not null default 3
        check (layer between 0 and 4);
    end if;

    -- Swarm association
    if not exists (
      select 1 from information_schema.columns
      where table_name = 'agents' and column_name = 'swarm_id'
    ) then
      alter table agents add column swarm_id uuid;
    end if;

    -- Business/project scope
    if not exists (
      select 1 from information_schema.columns
      where table_name = 'agents' and column_name = 'business_id'
    ) then
      alter table agents add column business_id uuid;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_name = 'agents' and column_name = 'project_id'
    ) then
      alter table agents add column project_id uuid;
    end if;

    -- Token + cost tracking
    if not exists (
      select 1 from information_schema.columns
      where table_name = 'agents' and column_name = 'tokens_used'
    ) then
      alter table agents add column tokens_used integer not null default 0;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_name = 'agents' and column_name = 'cost_usd'
    ) then
      alter table agents add column cost_usd numeric(10,6) not null default 0;
    end if;

    -- Task count
    if not exists (
      select 1 from information_schema.columns
      where table_name = 'agents' and column_name = 'tasks_completed'
    ) then
      alter table agents add column tasks_completed integer not null default 0;
    end if;

    -- Current task description
    if not exists (
      select 1 from information_schema.columns
      where table_name = 'agents' and column_name = 'current_task'
    ) then
      alter table agents add column current_task text;
    end if;

    -- Model being used
    if not exists (
      select 1 from information_schema.columns
      where table_name = 'agents' and column_name = 'model'
    ) then
      alter table agents add column model text not null default 'claude-sonnet-4-6';
    end if;

    -- When last active
    if not exists (
      select 1 from information_schema.columns
      where table_name = 'agents' and column_name = 'last_active_at'
    ) then
      alter table agents add column last_active_at timestamptz;
    end if;

  end if;
end $$;

-- ── Agent actions log ─────────────────────────────────────────────────────────
create table if not exists agent_actions (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null,
  user_id      text not null,
  action       text not null,                  -- e.g. "spawned", "tool_call", "completed"
  description  text,
  metadata     jsonb not null default '{}',
  tokens_used  integer not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists agent_actions_agent_id_idx on agent_actions (agent_id);
create index if not exists agent_actions_user_id_idx  on agent_actions (user_id);
create index if not exists agent_actions_created_at_idx on agent_actions (created_at desc);

-- ── Agent hierarchy index ─────────────────────────────────────────────────────
create index if not exists agents_parent_id_idx  on agents (parent_agent_id) where parent_agent_id is not null;
create index if not exists agents_swarm_id_idx   on agents (swarm_id)        where swarm_id is not null;
create index if not exists agents_layer_idx      on agents (layer);

-- ── RLS on agent_actions ──────────────────────────────────────────────────────
alter table agent_actions enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'agent_actions' and policyname = 'agent_actions_owner'
  ) then
    create policy agent_actions_owner on agent_actions
      using (user_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub'));
  end if;
end $$;

-- ── Record migration ──────────────────────────────────────────────────────────
insert into schema_migrations (filename) values ('008_agent_hierarchy.sql') on conflict do nothing;
