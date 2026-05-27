-- 084 — fixture_mode_active: per-operator toggle for the dev fixture harness.
--
-- When `enabled=true` for a given user, the platform overlays synthetic
-- connector + action fixtures on top of (or in place of) real OAuth
-- connections. Lets the operator exercise the full end-to-end UI flow
-- (create business → graduate → chat with the business → run smoke →
-- agent dispatches actions) without ever connecting a real third-party
-- account or burning real LLM dollars.
--
-- Single-tenant default — one row per Clerk user_id. Migration is
-- idempotent + fail-soft: if the column is missing in older deploys, the
-- fixture store falls back to disabled.

create table if not exists fixture_mode_active (
  user_id     text         not null primary key,
  enabled     boolean      not null default false,
  reason      text,
  updated_at  timestamptz  not null default now()
);

comment on table fixture_mode_active is
  'Per-operator toggle for the dev fixture harness. When enabled=true, '
  '`executeBusinessAction` returns canned responses + /settings/accounts '
  'surfaces synthetic rows for every platform in OAUTH_PROVIDERS. Lets the '
  'operator test the full platform UI flow without real OAuth.';

-- RLS — service-role only. The toggle flips from /api/dev/fixtures/active
-- which authenticates the operator via Clerk + writes through the service
-- role client. Direct client reads are not expected.
alter table fixture_mode_active enable row level security;

drop policy if exists fixture_mode_active_service_role on fixture_mode_active;
create policy fixture_mode_active_service_role on fixture_mode_active
  for all using (auth.role() = 'service_role');
