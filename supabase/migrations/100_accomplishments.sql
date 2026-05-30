-- 100 — accomplishments_unlocked: one-time tier-unlock ledger.
--
-- Backs the Gamify Accomplishments persistence layer. The /accomplishments
-- board computes tiers LIVE from real revenue (no table needed to render);
-- this ledger exists so the recompute cron fires the 'milestone' notification
-- EXACTLY ONCE per crossed tier — the row's presence is the transition guard
-- (an unlocked achievement already in the table never re-notifies, mirroring
-- the kill_switch_check edge-detection pattern).
--
-- Idempotent: re-running is a no-op. Deny-by-default RLS — service-role only
-- (the cron + the read API go through the service-role client; no direct
-- client reads).

create table if not exists accomplishments_unlocked (
  user_id        text        not null,
  achievement_id text        not null,
  level          int         not null default 0,
  unlocked_at    timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

comment on table accomplishments_unlocked is
  'One-time tier-unlock ledger for /accomplishments. Row presence = the '
  'transition guard so the milestone notification fires exactly once per tier.';

create index if not exists accomplishments_unlocked_user_idx
  on accomplishments_unlocked (user_id);

alter table accomplishments_unlocked enable row level security;

drop policy if exists accomplishments_unlocked_service_role on accomplishments_unlocked;
create policy accomplishments_unlocked_service_role
  on accomplishments_unlocked for all using (auth.role() = 'service_role');
