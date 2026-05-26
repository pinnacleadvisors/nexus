-- Migration 076 — historical timeseries for benchmark drift.
--
-- simulation_benchmarks (migration 074) only stores the LATEST drift
-- per benchmark via last_drift_pct. The operator-asked follow-up is
-- "show me the drift over time — sparkline of last 30 runs per
-- benchmark, so I see trajectory not just snapshot".
--
-- One row per cron tick per benchmark. Cheap to grow (one row / day
-- / benchmark by default; ~365 rows / year). Operator can prune
-- manually if it ever matters.

create table if not exists simulation_benchmark_runs (
  id                  uuid primary key default gen_random_uuid(),
  benchmark_id        uuid not null references simulation_benchmarks(id) on delete cascade,
  run_id              uuid,                                    -- soft reference into simulation_runs (no FK to avoid cascade)
  drift_pct           numeric(7,2),                            -- null on bootstrap rows (no baseline to diff against yet)
  sim_net_cents       int,
  failures            int,
  bootstrapped        boolean not null default false,           -- true on the first-run-becomes-baseline row
  alerted             boolean not null default false,           -- true when this run triggered a Slack alert
  ran_at              timestamptz not null default now(),
  result_snapshot     jsonb                                    -- the GradedRunResult that produced these numbers
);

create index if not exists simulation_benchmark_runs_bench_idx
  on simulation_benchmark_runs(benchmark_id, ran_at desc);

alter table simulation_benchmark_runs enable row level security;

drop policy if exists simulation_benchmark_runs_service on simulation_benchmark_runs;
create policy simulation_benchmark_runs_service on simulation_benchmark_runs
  for all to service_role
  using (true) with check (true);

comment on table simulation_benchmark_runs is
  'Per-cron-tick history for simulation_benchmarks (PR #376). Drives the sparkline on /simulate/benchmarks.';
