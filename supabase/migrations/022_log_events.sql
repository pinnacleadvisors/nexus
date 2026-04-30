-- Migration: 022_log_events
-- Description: Hot-field index for Vercel function logs streamed via the
--              `/api/vercel/log-drain` endpoint. The raw NDJSON payloads land
--              in R2 (`logs/<deployment_id>/<hour>.jsonl`); this table holds
--              the searchable fields agents need to slice by request_id /
--              route / time. The qa-runner reads this table on smoke failure
--              to attach a 30 s log window to the gateway dispatch brief.
--
-- Sensitive headers (`authorization`, `cookie`, `__session`, plus anything
-- listed in `VERCEL_LOG_REDACT_HEADERS`) MUST be stripped by the drain
-- endpoint before insert — this table is not encrypted at rest beyond
-- whatever Supabase provides by default.
--
-- Service role only. The bot reads via the `lib/logs/vercel.ts` helper which
-- uses the service-role client; no RLS exposure to the browser.

create table if not exists log_events (
  id              uuid        primary key default gen_random_uuid(),
  deployment_id   text,                                  -- vercel deployment id
  request_id      text,                                  -- vercel request id (per-invocation)
  route           text,                                  -- normalised path, e.g. /api/runs
  level           text,                                  -- info / warn / error / debug
  status          int,                                   -- HTTP status when present
  duration_ms     int,                                   -- function duration when present
  message         text        not null default '',       -- human-readable line
  raw_url         text,                                  -- R2 URL for the source NDJSON (one per hour shard)
  created_at      timestamptz not null default now()
);

-- Hot-path indexes. Queries we expect:
--   - `searchLogs({ requestId })`            → request_id_idx
--   - `attachLogsToBrief({ since })`         → created_at_idx
--   - `searchLogs({ route, since })`         → route_created_idx
--   - `searchLogs({ level: 'error' })`       → level_created_idx (errors are rare → covering index keeps it small)
--   - `searchLogs({ deploymentId, since })`  → deployment_created_idx (post-deploy slices)
create index if not exists log_events_request_id_idx
  on log_events (request_id)
  where request_id is not null;

create index if not exists log_events_created_at_idx
  on log_events (created_at desc);

create index if not exists log_events_route_created_idx
  on log_events (route, created_at desc)
  where route is not null;

create index if not exists log_events_level_created_idx
  on log_events (created_at desc)
  where level in ('error', 'warn');

create index if not exists log_events_deployment_created_idx
  on log_events (deployment_id, created_at desc)
  where deployment_id is not null;

-- RLS: deny-by-default. Service role bypasses; nothing else may read.
alter table log_events enable row level security;

drop policy if exists "log_events_service_only" on log_events;
create policy "log_events_service_only" on log_events
  for all
  using (false);

-- Retention helper. Vercel logs are noisy — keep 30 d in Supabase, longer in
-- R2 (cheap storage). Run via a daily cron once the drain is producing.
create or replace function log_events_purge_older_than(days int) returns int as $$
declare
  removed int;
begin
  delete from log_events
   where created_at < now() - (days::text || ' days')::interval
  returning 1 into removed;
  return coalesce(removed, 0);
end;
$$ language plpgsql security definer;
