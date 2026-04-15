-- 009_build_research.sql
-- Research digest store for Phase 19b — Weekly Research Loop
-- Each row is one run of the research cron / manual trigger.

create table if not exists build_research (
  id               uuid        primary key default gen_random_uuid(),
  user_id          text,
  run_at           timestamptz not null default now(),
  queries_run      jsonb       not null default '[]',
  suggestions      jsonb       not null default '[]',
  stack_issues     jsonb       not null default '[]',
  raw_search_count integer     not null default 0,
  duration_ms      integer     not null default 0,
  created_at       timestamptz not null default now()
);

-- Chronological ordering index
create index if not exists build_research_run_at_idx
  on build_research (run_at desc);

-- GIN index for JSON search over suggestions
create index if not exists build_research_suggestions_gin
  on build_research using gin (suggestions);

-- Row-level security
alter table build_research enable row level security;

create policy "Authenticated users can read research digests"
  on build_research for select
  using (auth.role() = 'authenticated');

create policy "Service role can insert research digests"
  on build_research for insert
  with check (true);
