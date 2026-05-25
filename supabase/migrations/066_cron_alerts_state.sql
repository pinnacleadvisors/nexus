-- 066_cron_alerts_state — single-row dedup state for the cron-health Slack alerter.
--
-- /api/cron/cron-health-alert runs every ~15 min via cron-job.org. Each
-- run pulls the current red-set from cron-job.org and compares to the
-- previous one stored here. We alert ONLY when:
--   - the red-set changed (added a new red cron), OR
--   - it's been ≥ 4h since the last alert (re-reminder for stuck cron)
--
-- Avoids the noise of every-15-min Slack pings when a cron stays red
-- without losing visibility for genuinely-new failures.
--
-- Single-row design — there's only one operator + one alert channel
-- today. When multi-tenant alerts ship, key on (user_id, channel).
--
-- Idempotent.

create table if not exists public.cron_alerts_state (
  id              smallint     primary key default 1,
  last_red_titles text[]       not null default '{}'::text[],
  last_alert_at   timestamptz,
  updated_at      timestamptz  not null default now(),

  constraint cron_alerts_state_single_row check (id = 1)
);

-- Seed the singleton row if absent. ON CONFLICT keeps re-runs harmless.
insert into public.cron_alerts_state (id)
values (1)
on conflict (id) do nothing;

alter table public.cron_alerts_state enable row level security;

drop policy if exists cron_alerts_state_service_role_all on public.cron_alerts_state;
create policy cron_alerts_state_service_role_all
  on public.cron_alerts_state for all
  using  (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
