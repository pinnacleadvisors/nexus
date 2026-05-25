-- 067_cron_alerts_thread_ts — track Slack thread ts for cron-health alerts.
--
-- v11 introduced the `:repeat:` prefix on reminder pings as a webhook-only
-- noise-reduction workaround (incoming webhooks don't support `thread_ts`).
-- v12 adds chat.postMessage support via SLACK_BOT_TOKEN — when configured,
-- the alerter REPLIES IN THREAD on the original top-level message instead
-- of starting a new top-level for every 4h reminder.
--
-- last_thread_ts:
--   - Set by the bot-token path on a NEW alert (titles changed).
--   - Read on reminder cycles to thread the reply.
--   - Cleared when the red-set goes empty (no jobs red → new thread next outage).
--
-- Idempotent.

alter table public.cron_alerts_state
  add column if not exists last_thread_ts text;
