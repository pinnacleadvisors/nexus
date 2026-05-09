-- 034_experiment_metrics.sql
--
-- Time-series telemetry for autonomous business experiments. Written by
-- the solopreneur-loop / codex-maintainer crons; read by the experiment
-- dashboard at /dashboard/experiments/[slug].
--
-- Each row is a single event keyed on `business_slug` + `ts`, with the
-- `kind` column acting as an enum-like discriminator and `payload` carrying
-- arbitrary structured data per kind.
--
-- See:
--   - app/api/cron/solopreneur-tick/route.ts      (writes `tick`, `kpi_snapshot`, `gate_event`, `kill_switch_check`)
--   - app/api/cron/codex-maintainer-tick/route.ts (writes `health_check`)
--   - lib/cost-guard.ts                           (writes `cash_spend`, `kill_switch_check`)
--   - lib/experiments/plan-billing-ledger.ts      (writes `plan_billing_estimate`)
--   - app/(protected)/dashboard/experiments/[slug]/page.tsx (reads last 30d)
--
-- Idempotent: re-running this migration on a DB that already has the table
-- is a no-op.

create table if not exists experiment_metrics (
  id            uuid primary key default gen_random_uuid(),
  business_slug text not null,
  ts            timestamptz not null default now(),
  kind          text not null check (kind in (
    'tick',
    'cash_spend',
    'revenue',
    'signup',
    'content_published',
    'kpi_snapshot',
    'plan_billing_estimate',
    'kill_switch_check',
    'gate_event',
    'health_check'
  )),
  payload       jsonb not null default '{}'::jsonb
);

-- Idempotent: re-running this migration on a DB that already has these
-- indexes is a no-op (we use IF NOT EXISTS).

-- Primary access pattern: dashboard reads last-N events for one business
-- ordered by time desc.
create index if not exists experiment_metrics_slug_ts_idx
  on experiment_metrics (business_slug, ts desc);

-- Secondary access pattern: cost-guard / ledger / kill-switch sum a single
-- `kind` (e.g. `cash_spend`, `plan_billing_estimate`) for one business.
create index if not exists experiment_metrics_slug_kind_ts_idx
  on experiment_metrics (business_slug, kind, ts desc);

alter table experiment_metrics enable row level security;

-- Service role bypasses RLS for server-side reads/writes from cron routes
-- and the dashboard. Direct client reads are intentionally not allowed —
-- go through the API.
drop policy if exists experiment_metrics_service_role_all on experiment_metrics;
create policy experiment_metrics_service_role_all on experiment_metrics
  for all using (true) with check (true);

comment on table experiment_metrics is
  'Time-series telemetry for autonomous business experiments. Written by solopreneur-loop / codex-maintainer crons; read by /dashboard/experiments/[slug].';
comment on column experiment_metrics.business_slug is
  'Scopes every row to one business (e.g. ''pdf-experiment-01''). No cross-business rows.';
comment on column experiment_metrics.kind is
  'Enum-like discriminator: tick, cash_spend, revenue, signup, content_published, kpi_snapshot, plan_billing_estimate, kill_switch_check, gate_event, health_check.';
comment on column experiment_metrics.payload is
  'Per-kind structured data. Shape varies by kind — see the writer in each route/lib for the schema.';
