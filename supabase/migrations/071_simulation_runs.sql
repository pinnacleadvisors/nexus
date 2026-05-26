-- Migration 071 — hyperbolic-chamber simulation runs
--
-- Why: lets the operator launch a time-compressed business simulation
-- (30 sim-days in 1 hour) with two modes — manual (operator approves
-- every gate, like clicking "next bar" in a trading replay) or auto-pilot
-- (deterministic heuristic decides; read stats at the end).
--
-- One row per launched simulation. Events stream into simulation_events
-- as the engine processes them. A partial unique index prevents two
-- live runs on the same business — second start returns the existing.

create table if not exists simulation_runs (
  id                     uuid primary key default gen_random_uuid(),
  user_id                text not null,
  business_slug          text not null,

  -- launch config
  mode                   text not null check (mode in ('manual','auto')),
  compress_days          int  not null check (compress_days between 1 and 365),
  wallclock_budget_sec   int  not null check (wallclock_budget_sec between 60 and 86400),
  approver_policy        text check (approver_policy in ('permissive','skeptical','random')),
  seed                   text not null,                                  -- derived from id + business state; deterministic replay

  -- runtime state
  status                 text not null default 'pending'
                         check (status in ('pending','running','paused','done','failed','cancelled')),
  current_sim_day        int  not null default 0,
  current_event_idx      int  not null default 0,                        -- pointer into the generated timeline
  total_events           int  not null default 0,                        -- set on start when timeline is generated

  started_at             timestamptz,
  ended_at               timestamptz,
  result                 jsonb,                                          -- {kpis_hit, approvals_issued, errors, sim_revenue_cents, sim_spend_cents}

  created_at             timestamptz not null default now()
);

-- One live run per business. status IN ('pending','running','paused') is the
-- "live" window; 'done'|'failed'|'cancelled' are terminal so multiple may coexist.
create unique index if not exists simulation_runs_one_live_per_business
  on simulation_runs(business_slug)
  where status in ('pending','running','paused');

create index if not exists simulation_runs_user_idx
  on simulation_runs(user_id, created_at desc);

create index if not exists simulation_runs_business_idx
  on simulation_runs(business_slug, created_at desc);

-- Events as they unfold. Engine writes one row per processed event so
-- the UI can replay the full timeline; auto-mode runs through everything
-- in one server call, manual-mode adds rows one tick at a time.
create table if not exists simulation_events (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references simulation_runs(id) on delete cascade,

  -- position in the simulated timeline
  sim_day           int  not null,
  sim_hour          numeric(5,2) not null,                              -- 0.00 - 23.99

  -- shape
  kind              text not null
                    check (kind in ('inbound_ticket','agent_action','approval_gate','kpi_snapshot','failure','note')),
  payload           jsonb not null,

  -- approval-gate specifics (null for non-gate events)
  approval_state    text check (approval_state in ('pending','approved','rejected','auto_approved','auto_rejected')),
  approved_by       text,                                                -- 'operator' | 'auto:<policy>'
  decided_at        timestamptz,

  -- outcome (filled when event is processed; agent_action records dispatched=true/false, etc.)
  outcome           jsonb,

  created_at        timestamptz not null default now()
);

create index if not exists simulation_events_run_idx
  on simulation_events(run_id, sim_day, sim_hour);

create index if not exists simulation_events_pending_gates_idx
  on simulation_events(run_id) where kind = 'approval_gate' and approval_state = 'pending';

-- RLS — service-role writes only. UI reads go through API routes that
-- run with the service role after auth() gates the user.
alter table simulation_runs    enable row level security;
alter table simulation_events  enable row level security;

drop policy if exists simulation_runs_owner    on simulation_runs;
drop policy if exists simulation_events_owner  on simulation_events;

create policy simulation_runs_owner on simulation_runs
  for all to service_role
  using (true) with check (true);

create policy simulation_events_owner on simulation_events
  for all to service_role
  using (true) with check (true);

-- Allow authenticated reads scoped to the row's user_id so future
-- direct-from-client patterns can opt in without rewriting routes.
drop policy if exists simulation_runs_user_read on simulation_runs;
create policy simulation_runs_user_read on simulation_runs
  for select to authenticated
  using (user_id = current_setting('request.jwt.claims', true)::jsonb ->> 'sub');

drop policy if exists simulation_events_user_read on simulation_events;
create policy simulation_events_user_read on simulation_events
  for select to authenticated
  using (run_id in (select id from simulation_runs where user_id = current_setting('request.jwt.claims', true)::jsonb ->> 'sub'));

comment on table simulation_runs    is 'Hyperbolic-chamber simulation runs — operator-launched, time-compressed business scenarios. Phase 1: PR #364.';
comment on table simulation_events  is 'Per-event log for a simulation run — drives the bar-by-bar replay UI and the final graded report.';
