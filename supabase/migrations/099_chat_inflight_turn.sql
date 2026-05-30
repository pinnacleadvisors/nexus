-- 099_chat_inflight_turn.sql — durable chat: track the in-flight gateway job per
-- session so a turn survives the browser closing.
--
-- A chat turn is dispatched as a detached gateway job; today its reply is only
-- persisted when a browser poll sees status='done'. Close the tab and the poll
-- loop dies, so the gateway GCs the result after RETAIN_MS and the reply is
-- lost. These columns let a server-side reconciler (cron) drain the finished
-- job to chat_messages with no browser, and an atomic claim guarantees the
-- reconciler and a late poll never double-persist.
--
-- inflight_drained defaults TRUE (= "no turn in flight"); set to FALSE on
-- enqueue, flipped back to TRUE by whichever writer claims the completed turn.
-- Additive + idempotent.

alter table chat_sessions add column if not exists inflight_job_id     text;
alter table chat_sessions add column if not exists inflight_started_at timestamptz;
alter table chat_sessions add column if not exists inflight_drained    boolean not null default true;

-- Partial index: the reconciler scans only sessions with an undrained turn.
create index if not exists chat_sessions_inflight_idx
  on chat_sessions (inflight_started_at)
  where inflight_drained = false;
