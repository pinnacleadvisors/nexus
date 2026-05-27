-- 083_ai_provider_active.sql
--
-- Per-operator "which LLM provider is active right now" toggle. Replaces
-- (with fallback to) the Doppler LLM_PROVIDER env var so the operator
-- can flip from /settings → AI Providers without redeploying nexus-app.
--
-- Single row per user — when the operator picks Mimo, OpenRouter, or
-- back to Claude, the row's `provider` updates. The /api/llm-provider/
-- active endpoint writes the row + invalidates the lib/llm/provider-settings
-- module cache so the next getLlmAsync() call routes correctly within
-- the cache TTL window (~30s).
--
-- Read path: lib/llm/provider-settings.ts → getActiveProvider() returns
-- { provider, model? } merged with env fallback. When the row is missing
-- OR the table doesn't exist (migration unapplied), env vars win.
--
-- This is a USER-LEVEL preference (not per-business) because the entire
-- platform shares one provider chain in lean mode. Future v2 could add a
-- business_slug column to scope it per-business.

create table if not exists ai_provider_active (
  user_id     text         not null primary key,
  provider    text         not null,
  model       text,
  reason      text,
  updated_at  timestamptz  not null default now()
);

alter table ai_provider_active enable row level security;

drop policy if exists ai_provider_active_service_role on ai_provider_active;
create policy ai_provider_active_service_role on ai_provider_active
  for all to service_role
  using (true)
  with check (true);

comment on table ai_provider_active is
  'Per-operator dynamic LLM_PROVIDER override. Presence wins over the Doppler env var. PR claude/dynamic-llm-provider-2026-05-27.';
comment on column ai_provider_active.provider is
  'One of: claude | openrouter | mimo | ollama. Validated at write time by /api/llm-provider/active.';
