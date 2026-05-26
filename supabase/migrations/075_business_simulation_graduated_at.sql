-- Migration 075 — record when a sim business was graduated to real money.
--
-- POST /api/businesses/:slug/graduate flips simulation=false. Without
-- a timestamp, the operator can't tell at a glance "was this business
-- always real, or did it graduate last Tuesday?" — the answer matters
-- for cost-guard cap interpretation (spend before graduation was
-- short-circuited; spend after is real).

alter table business_operators
  add column if not exists simulation_graduated_at timestamptz;

comment on column business_operators.simulation_graduated_at is
  'Set when POST /api/businesses/:slug/graduate flipped simulation=false. NULL = either still a sim OR was real from the start.';
