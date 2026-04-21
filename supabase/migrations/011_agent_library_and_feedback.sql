-- 011_agent_library_and_feedback.sql
-- Persists Claude managed agent specs (mirrors .claude/agents/*.md) and
-- the review-node feedback loop that the workflow-optimizer agent consumes.

-- ── Agent library ─────────────────────────────────────────────────────────────
create table if not exists agent_library (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null,
  slug            text not null,
  name            text not null,
  description     text not null,
  tools           text[]  not null default '{}',
  model           text    not null default 'claude-sonnet-4-6',
  transferable    boolean not null default true,
  env_vars        text[]  not null default '{}',
  system_prompt   text    not null,
  source_path     text,
  version         integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, slug)
);

create index if not exists agent_library_user_idx on agent_library (user_id);
create index if not exists agent_library_slug_idx on agent_library (slug);

-- ── Review-node feedback ──────────────────────────────────────────────────────
-- Captures every piece of quality feedback submitted on a Board review node.
-- The workflow-optimizer agent reads unresolved rows, proposes a change, then
-- writes a workflow_changelog row and flips status to 'applied'.
create table if not exists workflow_feedback (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null,
  card_id         text,
  agent_slug      text,
  feedback        text not null,
  status          text not null default 'open'
                    check (status in ('open', 'triaged', 'applied', 'rejected')),
  artifact_url    text,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);

create index if not exists workflow_feedback_user_idx   on workflow_feedback (user_id);
create index if not exists workflow_feedback_status_idx on workflow_feedback (status);
create index if not exists workflow_feedback_agent_idx  on workflow_feedback (agent_slug);

-- ── Workflow changelog ────────────────────────────────────────────────────────
-- Every applied optimization emits a row here. before_spec / after_spec hold
-- the diffable payload (markdown body, n8n JSON, capability snapshot).
create table if not exists workflow_changelog (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null,
  agent_slug      text,
  feedback_id     uuid references workflow_feedback(id) on delete set null,
  target_path     text not null,
  before_spec     text,
  after_spec      text,
  rationale       text,
  applied_by      text not null default 'workflow-optimizer',
  created_at      timestamptz not null default now()
);

create index if not exists workflow_changelog_user_idx  on workflow_changelog (user_id);
create index if not exists workflow_changelog_agent_idx on workflow_changelog (agent_slug);
create index if not exists workflow_changelog_created_idx on workflow_changelog (created_at desc);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table agent_library      enable row level security;
alter table workflow_feedback  enable row level security;
alter table workflow_changelog enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'agent_library' and policyname = 'agent_library_owner'
  ) then
    create policy agent_library_owner on agent_library
      using (user_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub'))
      with check (user_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub'));
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'workflow_feedback' and policyname = 'workflow_feedback_owner'
  ) then
    create policy workflow_feedback_owner on workflow_feedback
      using (user_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub'))
      with check (user_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub'));
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'workflow_changelog' and policyname = 'workflow_changelog_owner'
  ) then
    create policy workflow_changelog_owner on workflow_changelog
      using (user_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub'))
      with check (user_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub'));
  end if;
end $$;

-- ── Record migration ──────────────────────────────────────────────────────────
insert into schema_migrations (filename) values ('011_agent_library_and_feedback.sql')
  on conflict do nothing;
