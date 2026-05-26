-- Migration 072 — A/B comparison support for hyperbolic-chamber runs.
--
-- v1 had a strict "one live run per business" unique index — fine for
-- solo runs, but blocks the most useful comparison flow: launch N
-- policies (permissive vs skeptical vs random) against the SAME seed
-- and watch them race. Like running multiple trading strategies on the
-- same historical bar replay.
--
-- This migration:
--   1. Adds `compare_group_id` (uuid, nullable). Solo runs leave it
--      NULL. A/B runs share a single uuid across their rows.
--   2. Replaces the unique index with one that ONLY enforces mutex on
--      SOLO runs. A/B groups can have multiple concurrent rows for
--      the same business.
--
-- Why drop-and-recreate rather than ALTER: Postgres partial unique
-- indexes can't be ALTERed in-place to change the WHERE clause.

alter table simulation_runs
  add column if not exists compare_group_id uuid;

create index if not exists simulation_runs_group_idx
  on simulation_runs(compare_group_id)
  where compare_group_id is not null;

drop index if exists simulation_runs_one_live_per_business;

create unique index if not exists simulation_runs_one_solo_live_per_business
  on simulation_runs(business_slug)
  where status in ('pending','running','paused') and compare_group_id is null;

comment on column simulation_runs.compare_group_id is
  'Non-null = part of an A/B comparison group. NULL = solo run (mutex via simulation_runs_one_solo_live_per_business).';
