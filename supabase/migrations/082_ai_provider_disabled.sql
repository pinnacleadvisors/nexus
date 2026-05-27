-- 082_ai_provider_disabled.sql
--
-- Per-operator "don't use this AI provider" toggle. Presence-based design:
-- a row in this table means the provider is DISABLED. Absence means default
-- (enabled, falling back through the normal detect-and-prefer chain).
--
-- Why not a boolean on connected_accounts? Three reasons:
--   1. env-var providers (anthropic/openai/openrouter via gateway / API key)
--      don't have a connected_accounts row, so a column there can't represent
--      their state.
--   2. The toggle is a user-level preference, not an account-property. Even
--      if a row's provider is connected through Composio, the operator might
--      want to globally turn it off.
--   3. Presence-based is easier to reason about — INSERT on disable,
--      DELETE on enable. No tristate (true/false/null).
--
-- Read path: lib/models/provider-toggle.ts → loadDisabledProviders(userId).
-- Write path: PATCH /api/models/providers/:provider → setProviderDisabled().
--
-- Idempotent: re-running the migration is a no-op via IF NOT EXISTS guards.

create table if not exists ai_provider_disabled (
  user_id      text         not null,
  provider     text         not null,
  -- audit-friendly: when did the operator disable + why (optional free text)
  reason       text,
  disabled_at  timestamptz  not null default now(),
  primary key (user_id, provider)
);

-- RLS is service-role-only by default for new tables; the helpers in
-- lib/models/provider-toggle.ts run with the service-role client so we
-- don't need a per-user policy here. Documented intent.
alter table ai_provider_disabled enable row level security;

-- Service-role has full access (used by API routes via createServerClient).
drop policy if exists ai_provider_disabled_service_role on ai_provider_disabled;
create policy ai_provider_disabled_service_role on ai_provider_disabled
  for all to service_role
  using (true)
  with check (true);

-- Future-proofing: index for `delete where user_id=$1 and provider=$2`
-- which is the dominant query pattern. The PK already covers this, but
-- a separate user_id index helps when we add admin/audit dashboards
-- that list every disable per user.
create index if not exists ai_provider_disabled_user_id_idx
  on ai_provider_disabled (user_id);
