-- Migration: 020_signals
-- Description: Captures fleeting platform-improvement ideas (links, hunches,
--              recurring errors, open questions). A daily LLM council reviews
--              every `new` row and assigns a verdict — accepted, rejected,
--              deferred, implemented. Each council role writes one row to
--              signal_evaluations so the reasoning trail is auditable and the
--              workflow-optimizer can learn from past decisions.

-- ── Signals ───────────────────────────────────────────────────────────────────
create table if not exists signals (
  id              uuid        primary key default gen_random_uuid(),
  user_id         text        not null,
  kind            text        not null
                              check (kind in ('idea','link','error','question')),
  title           text        not null,
  body            text        not null default '',
  url             text,
  status          text        not null default 'new'
                              check (status in ('new','triaging','accepted','rejected','implemented','deferred')),
  decided_reason  text,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists signals_user_created_idx on signals (user_id, created_at desc);
create index if not exists signals_status_idx       on signals (user_id, status);
create index if not exists signals_new_idx          on signals (status) where status = 'new';

-- ── Council evaluations ──────────────────────────────────────────────────────
-- Each council role (scout / memory / architect / tester / judge) writes
-- one row per signal. The judge row is the authoritative verdict and mirrors
-- onto signals.status + signals.decided_reason.
create table if not exists signal_evaluations (
  id            uuid        primary key default gen_random_uuid(),
  signal_id     uuid        not null references signals(id) on delete cascade,
  user_id       text        not null,
  role          text        not null
                            check (role in ('scout','memory','architect','tester','judge')),
  verdict       text,
  reasoning     text        not null,
  model         text,
  created_at    timestamptz not null default now()
);

create index if not exists signal_eval_signal_idx on signal_evaluations (signal_id);
create index if not exists signal_eval_user_idx   on signal_evaluations (user_id, created_at desc);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table signals            enable row level security;
alter table signal_evaluations enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'signals' and policyname = 'signals_owner'
  ) then
    create policy signals_owner on signals
      using (user_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub'))
      with check (user_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub'));
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'signal_evaluations' and policyname = 'signal_evaluations_owner'
  ) then
    create policy signal_evaluations_owner on signal_evaluations
      using (user_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub'))
      with check (user_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub'));
  end if;
end $$;

-- ── Record migration ──────────────────────────────────────────────────────────
insert into schema_migrations (filename) values ('020_signals.sql')
  on conflict do nothing;
