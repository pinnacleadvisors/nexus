-- 091 — notification_settings + push_subscriptions (R4 of UX consult).
--
-- Per-operator notification routing. Each category × channel pair has an
-- enable flag. Defaults are operator-friendly: Slack DM + web push ON for
-- HIGH-severity events (approvals, kill-switch, security alerts), OFF for
-- everything else.
--
-- Channel options (V1):
--   - 'slack'    — DM to operator's Slack via Composio. Target lives in
--                  `notification_slack_targets.channel_id` (defaults to
--                  #approvals per operator brain-dump).
--   - 'webpush'  — Browser push via VAPID. Requires VAPID_PUBLIC_KEY +
--                  VAPID_PRIVATE_KEY in Doppler + active subscription
--                  recorded in push_subscriptions.
--
-- Category options (V1):
--   - 'approval-pending' — new approval landed and needs decision
--   - 'kill-switch'      — cost-guard fired on a business
--   - 'graduation'       — a business graduated to real-money
--   - 'security-alert'   — system-alert kind=security
--   - 'weekly-digest'    — R6's Sunday digest summary push
--
-- Migration is idempotent.

create table if not exists notification_settings (
  user_id     text   not null,
  channel     text   not null check (channel in ('slack', 'webpush')),
  category    text   not null check (category in (
    'approval-pending', 'kill-switch', 'graduation',
    'security-alert',   'weekly-digest'
  )),
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (user_id, channel, category)
);

comment on table notification_settings is
  'Per-operator notification routing. Each row = one (channel, category) '
  'opt-in. R4 of UX consult 2026-05-27.';

create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     text   not null,
  endpoint    text   not null,
  p256dh      text   not null,
  auth        text   not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz,
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_id_idx
  on push_subscriptions (user_id);

comment on table push_subscriptions is
  'Web Push API subscriptions per operator browser. VAPID-signed pushes '
  'delivered via lib/notifications/webpush.ts. Idempotent: same endpoint '
  'overwrites the prior row.';

-- Slack target per operator. Single row per user — operator picks ONE
-- channel where DMs land. Default discovery: pick the connected Slack
-- account's user DM at notify-time; operator can override here.
create table if not exists notification_slack_targets (
  user_id     text   primary key,
  channel_id  text   not null,
  channel_name text,
  composio_account_id text,
  updated_at  timestamptz not null default now()
);

comment on table notification_slack_targets is
  'Operator-chosen Slack channel where notifications DM. Default per '
  'brain-dump 2026-05-27: #approvals channel of the connected workspace.';

-- RLS — service-role only. Routes that read/write settings go through
-- the service-role client. Direct client reads are not exposed.
alter table notification_settings        enable row level security;
alter table push_subscriptions           enable row level security;
alter table notification_slack_targets   enable row level security;

drop policy if exists notification_settings_service_role        on notification_settings;
drop policy if exists push_subscriptions_service_role           on push_subscriptions;
drop policy if exists notification_slack_targets_service_role   on notification_slack_targets;

create policy notification_settings_service_role        on notification_settings        for all using (auth.role() = 'service_role');
create policy push_subscriptions_service_role           on push_subscriptions           for all using (auth.role() = 'service_role');
create policy notification_slack_targets_service_role   on notification_slack_targets   for all using (auth.role() = 'service_role');
