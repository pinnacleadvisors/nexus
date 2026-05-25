-- Migration: 068_business_slack_bot
-- Description: per-business Slack bot config (chat.postMessage path).
-- Today businesses.slack_webhook_url pins a channel via an incoming webhook;
-- v13 adds optional bot-token + channel-id so cron-health-alert can route
-- per-business alerts via chat.postMessage and reply in-thread on reminders.
-- Backwards compatible — when slack_bot_token is null the alerter falls back
-- to the existing webhook path.
--
-- Per-business secret storage. Following the existing slack_webhook_url
-- convention (plaintext on this table, RLS-gated). Migration 026 documents
-- the future _enc pattern if/when we encrypt — we mirror that pattern here
-- by leaving the column nullable + plaintext and reserving slack_bot_token_enc
-- for a later additive migration.
alter table public.businesses
  add column if not exists slack_bot_token  text,
  add column if not exists slack_channel_id text;

comment on column public.businesses.slack_bot_token  is
  'Optional per-business Slack bot token (xoxb-…) used by chat.postMessage for threaded replies on cron alerts. NULL → falls back to slack_webhook_url.';
comment on column public.businesses.slack_channel_id is
  'Slack channel ID (e.g. C123ABC) — the bot-API form, distinct from the human-friendly slack_channel name. Required when slack_bot_token is set.';
