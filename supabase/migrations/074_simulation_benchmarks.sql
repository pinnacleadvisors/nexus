-- Migration 074 — drift-alarm benchmark cron for hyperbolic-chamber
-- (v2-D, PR #368). Establishes a daily-firing cron that re-runs a
-- known-good simulation config (FIXED seed) and diffs against a stored
-- baseline. If sim revenue / approval rate / failure count drift more
-- than `drift_threshold_pct`, a Slack alert fires.
--
-- Why this matters: the chaos harness only catches regressions if it
-- itself is healthy. A code change that breaks the engine could
-- silently degrade everyone's runs. This cron is the canary.

create table if not exists simulation_benchmarks (
  id                     uuid primary key default gen_random_uuid(),
  name                   text unique not null,                  -- 'canonical-pdf-saas', 'high-volatility-test', …
  business_slug          text not null,                          -- must reference a sim business
  seed                   text not null,                          -- FIXED — never regenerated
  compress_days          int  not null check (compress_days between 1 and 365),
  wallclock_budget_sec   int  not null default 600,
  approver_policy        text not null check (approver_policy in ('permissive', 'skeptical', 'random')),
  synthetic_voice        text not null default 'template' check (synthetic_voice in ('template', 'llm')),
  drift_threshold_pct    numeric(5,2) not null default 5.00,     -- alert when |delta| > this %
  -- Snapshot of the first successful run's result. Null until bootstrapped.
  baseline_result        jsonb,
  baseline_run_id        uuid,                                   -- soft reference; no FK to avoid cascade headaches
  baseline_set_at        timestamptz,
  -- Latest re-run (rolling)
  last_run_result        jsonb,
  last_run_id            uuid,
  last_run_at            timestamptz,
  last_drift_pct         numeric(7,2),                           -- positive = revenue up; negative = revenue down
  last_alert_at          timestamptz,                            -- so we don't spam Slack every cron tick when drift is sustained
  -- Control
  enabled                boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists simulation_benchmarks_enabled_idx
  on simulation_benchmarks(enabled) where enabled = true;

-- RLS — service-role writes only (cron runs server-side)
alter table simulation_benchmarks enable row level security;

drop policy if exists simulation_benchmarks_service on simulation_benchmarks;
create policy simulation_benchmarks_service on simulation_benchmarks
  for all to service_role
  using (true) with check (true);

comment on table simulation_benchmarks is
  'Daily canary runs for hyperbolic-chamber drift detection (v2-D). Each row defines a fixed-seed sim that the benchmark cron re-runs; diff against baseline_result triggers a Slack alert when |drift| > drift_threshold_pct.';
