-- 007_libraries.sql
-- Reusable building-block library: code snippets, agent templates,
-- prompt templates, and skill definitions.
-- Agents query these tables before generating anything new to reduce
-- duplicate work and per-task token spend.

-- ── Code snippets ─────────────────────────────────────────────────────────────
create table if not exists code_snippets (
  id                  uuid primary key default gen_random_uuid(),
  user_id             text not null,
  title               text not null,
  description         text,
  language            text not null default 'typescript',
  purpose             text,
  code                text not null,
  tags                text[]   not null default '{}',
  dependencies        text[]   not null default '{}',
  usage_count         integer  not null default 0,
  avg_quality_score   float    not null default 0.0,
  auto_extracted      boolean  not null default false,
  source_agent_run    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── Agent templates ───────────────────────────────────────────────────────────
create table if not exists agent_templates (
  id                  uuid primary key default gen_random_uuid(),
  user_id             text not null,
  name                text not null,
  role                text not null,
  system_prompt       text not null,
  constraints         text[]   not null default '{}',
  output_format       text     not null default 'markdown',
  example_output      text,
  model               text     not null default 'claude-sonnet-4-6',
  tags                text[]   not null default '{}',
  version             integer  not null default 1,
  usage_count         integer  not null default 0,
  avg_quality_score   float    not null default 0.0,
  auto_extracted      boolean  not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── Prompt templates ──────────────────────────────────────────────────────────
create table if not exists prompt_templates (
  id                  uuid primary key default gen_random_uuid(),
  user_id             text not null,
  name                text not null,
  description         text,
  template            text not null,
  variables           text[]   not null default '{}',
  format              text     not null default 'instruction',
  neuro_score         integer  not null default 0,
  tags                text[]   not null default '{}',
  usage_count         integer  not null default 0,
  avg_quality_score   float    not null default 0.0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── Skill definitions ─────────────────────────────────────────────────────────
create table if not exists skill_definitions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             text not null,
  name                text not null,
  description         text,
  mcp_tool_name       text not null,
  input_schema        jsonb    not null default '{}',
  output_schema       jsonb    not null default '{}',
  requires_openclaw   boolean  not null default false,
  risk_level          text     not null default 'low',
  tags                text[]   not null default '{}',
  usage_count         integer  not null default 0,
  avg_quality_score   float    not null default 0.0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists code_snippets_user_id_idx    on code_snippets    (user_id);
create index if not exists code_snippets_language_idx   on code_snippets    (language);
create index if not exists code_snippets_tags_idx       on code_snippets    using gin (tags);
create index if not exists agent_templates_user_id_idx  on agent_templates  (user_id);
create index if not exists agent_templates_tags_idx     on agent_templates  using gin (tags);
create index if not exists prompt_templates_user_id_idx on prompt_templates (user_id);
create index if not exists prompt_templates_tags_idx    on prompt_templates using gin (tags);
create index if not exists skill_defs_user_id_idx       on skill_definitions (user_id);
create index if not exists skill_defs_tags_idx          on skill_definitions using gin (tags);

-- ── updated_at triggers ───────────────────────────────────────────────────────
create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'code_snippets_updated_at') then
    create trigger code_snippets_updated_at
      before update on code_snippets
      for each row execute function update_updated_at_column();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'agent_templates_updated_at') then
    create trigger agent_templates_updated_at
      before update on agent_templates
      for each row execute function update_updated_at_column();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'prompt_templates_updated_at') then
    create trigger prompt_templates_updated_at
      before update on prompt_templates
      for each row execute function update_updated_at_column();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'skill_definitions_updated_at') then
    create trigger skill_definitions_updated_at
      before update on skill_definitions
      for each row execute function update_updated_at_column();
  end if;
end $$;

-- ── Row-level security ────────────────────────────────────────────────────────
alter table code_snippets    enable row level security;
alter table agent_templates  enable row level security;
alter table prompt_templates enable row level security;
alter table skill_definitions enable row level security;

-- All-access policies (owner only via Clerk sub JWT claim)
do $$ begin
  -- code_snippets
  if not exists (select 1 from pg_policies where tablename='code_snippets' and policyname='code_snippets_owner') then
    create policy code_snippets_owner on code_snippets
      using (user_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub'));
  end if;
  -- agent_templates
  if not exists (select 1 from pg_policies where tablename='agent_templates' and policyname='agent_templates_owner') then
    create policy agent_templates_owner on agent_templates
      using (user_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub'));
  end if;
  -- prompt_templates
  if not exists (select 1 from pg_policies where tablename='prompt_templates' and policyname='prompt_templates_owner') then
    create policy prompt_templates_owner on prompt_templates
      using (user_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub'));
  end if;
  -- skill_definitions
  if not exists (select 1 from pg_policies where tablename='skill_definitions' and policyname='skill_defs_owner') then
    create policy skill_defs_owner on skill_definitions
      using (user_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub'));
  end if;
end $$;

-- Record migration
insert into schema_migrations (version) values ('007') on conflict do nothing;
