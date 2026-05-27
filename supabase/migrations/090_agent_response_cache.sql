-- 090 — agent_response_cache: smart caching layer for agent dispatches.
--
-- Operator brain-dump 2026-05-27: add smart caching across agent dispatches.
-- Same input → same output via cached response. Dramatic cost drop when
-- agents re-ask the same question (niche-research, trend-scouting, audit
-- lookups, etc.).
--
-- Cache key shape:
--   input_hash = sha256(agent_slug || ':' || stable-json(arguments))
--
-- TTL is per-row (so different agents can have different freshness needs).
-- Read with `select ... where input_hash = ? and expires_at > now()`.
-- Write with `insert ... on conflict (input_hash) do update set ...`.
--
-- Eviction: LRU at 10k rows via the background cron
-- `/api/cron/agent-cache-evict` (deferred to follow-up PR).
--
-- This migration is idempotent (IF NOT EXISTS guards).

create table if not exists agent_response_cache (
  input_hash    text primary key,
  agent_slug    text not null,
  arguments     jsonb,
  output        jsonb not null,
  hit_count     integer not null default 0,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  -- Stored separately so the cache can be reasoned about by business
  -- (e.g. "blow away all rows for business X when its niche changes").
  business_slug text
);

create index if not exists agent_response_cache_agent_slug_idx
  on agent_response_cache (agent_slug);

create index if not exists agent_response_cache_business_slug_idx
  on agent_response_cache (business_slug)
  where business_slug is not null;

create index if not exists agent_response_cache_expires_at_idx
  on agent_response_cache (expires_at);

create index if not exists agent_response_cache_last_used_at_idx
  on agent_response_cache (last_used_at);

comment on table agent_response_cache is
  'Smart-caching layer for agent dispatches (R3+ of UX consult / brain-dump '
  '2026-05-27). Same input → same output via cached row. Per-row TTL via '
  'expires_at. LRU eviction at 10k rows by /api/cron/agent-cache-evict '
  '(deferred). business_slug is optional partitioning so cache can be '
  'invalidated per-business when the business pivots.';

-- RLS — service-role only (cache is internal, never exposed to clients).
alter table agent_response_cache enable row level security;

drop policy if exists agent_response_cache_service_role on agent_response_cache;
create policy agent_response_cache_service_role on agent_response_cache
  for all using (auth.role() = 'service_role');
