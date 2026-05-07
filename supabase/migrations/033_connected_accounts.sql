-- 033_connected_accounts.sql
--
-- Per-business OAuth connection registry. Each row maps
-- (user, business_slug, platform) → Composio `connected_account_id`.
--
-- Composio brokers the OAuth flow + token refresh; we store only the
-- handle, status, and timestamps. The actual access/refresh tokens live
-- inside Composio and never touch this DB.
--
-- See:
--   - lib/composio/client.ts        (initiateConnection / executeAction)
--   - app/api/oauth/composio/init   (starts a flow)
--   - app/api/oauth/composio/callback (lands here, writes a row)
--   - lib/composio/actions.ts       (looks up the row at action time)
--
-- Idempotent: re-running this migration on a DB that already has the table
-- is a no-op.

create table if not exists connected_accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             text not null,
  business_slug       text,
  platform            text not null,
  composio_account_id text not null,
  status              text not null default 'active' check (status in ('active','revoked','error')),
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  last_used_at        timestamptz
);

-- Idempotent: re-running this migration on a DB that already has these
-- indexes is a no-op (we use IF NOT EXISTS).
create index if not exists connected_accounts_user_business_idx
  on connected_accounts (user_id, business_slug);

create index if not exists connected_accounts_platform_idx
  on connected_accounts (platform) where status = 'active';

-- One active account per (user, business, platform). NULL business_slug
-- means "default for this user" — partial indexes let us enforce uniqueness
-- separately for business-scoped vs user-default rows.
create unique index if not exists connected_accounts_active_unique_business_idx
  on connected_accounts (user_id, business_slug, platform)
  where status = 'active' and business_slug is not null;

create unique index if not exists connected_accounts_active_unique_default_idx
  on connected_accounts (user_id, platform)
  where status = 'active' and business_slug is null;

alter table connected_accounts enable row level security;

-- Service role bypasses RLS for server-side reads/writes from API routes.
-- Direct client reads are intentionally not allowed — go through the API.
drop policy if exists connected_accounts_service_role_all on connected_accounts;
create policy connected_accounts_service_role_all on connected_accounts
  for all using (true) with check (true);

comment on table connected_accounts is
  'Per-business OAuth connections brokered through Composio. Tokens live in Composio.';
comment on column connected_accounts.business_slug is
  'NULL = user-default (used when no business context). Else: business this account belongs to.';
comment on column connected_accounts.composio_account_id is
  'Composio''s connected_account_id. Pass to lib/composio/client.executeAction().';
