-- 010_ideas_and_automations.sql
-- Persists captured ideas and generated n8n workflows across sessions / devices.
-- Previously both were stored in localStorage under keys nexus:ideas and
-- nexus:automations — this migration moves them to the per-user tables below.

-- ── Ideas ─────────────────────────────────────────────────────────────────────
create table if not exists ideas (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  text not null,
  mode                     text not null check (mode in ('remodel','description')),
  description              text not null,
  inspiration_url          text,
  twist                    text,
  setup_budget_usd         integer,
  how_it_makes_money       text not null default '',
  approx_monthly_revenue   integer not null default 0,
  approx_setup_cost        integer not null default 0,
  approx_monthly_cost      integer not null default 0,
  automation_percent       integer not null default 0,
  profitable_verdict       text not null default 'uncertain'
                            check (profitable_verdict in ('likely','unlikely','uncertain')),
  profitable_reasoning     text not null default '',
  steps                    jsonb not null default '[]',
  tools                    jsonb not null default '[]',
  sources                  jsonb not null default '[]',  -- scrape + web-search provenance
  created_at               timestamptz not null default now()
);

create index if not exists idx_ideas_user_created
  on ideas(user_id, created_at desc);

-- ── Automations (generated n8n workflows) ─────────────────────────────────────
create table if not exists automations (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null,
  idea_id         uuid references ideas(id) on delete cascade,
  name            text not null,
  workflow_type   text not null check (workflow_type in ('build','maintain')),
  workflow_json   jsonb not null,
  checklist       jsonb not null default '[]',
  explanation     text not null default '',
  imported_id     text,               -- n8n workflow id on successful live import
  import_error    text,               -- reason live import failed (else NULL)
  created_at      timestamptz not null default now()
);

create index if not exists idx_automations_user_created
  on automations(user_id, created_at desc);

create index if not exists idx_automations_idea
  on automations(idea_id);

-- ── RLS — mirrors the pattern in 004_rls_policies.sql ────────────────────────
alter table ideas       enable row level security;
alter table automations enable row level security;

-- Ideas
drop policy if exists ideas_select on ideas;
create policy ideas_select on ideas
  for select using (user_id = (auth.jwt() ->> 'sub'));

drop policy if exists ideas_insert on ideas;
create policy ideas_insert on ideas
  for insert with check (user_id = (auth.jwt() ->> 'sub'));

drop policy if exists ideas_delete on ideas;
create policy ideas_delete on ideas
  for delete using (user_id = (auth.jwt() ->> 'sub'));

-- Automations
drop policy if exists automations_select on automations;
create policy automations_select on automations
  for select using (user_id = (auth.jwt() ->> 'sub'));

drop policy if exists automations_insert on automations;
create policy automations_insert on automations
  for insert with check (user_id = (auth.jwt() ->> 'sub'));

drop policy if exists automations_delete on automations;
create policy automations_delete on automations
  for delete using (user_id = (auth.jwt() ->> 'sub'));
