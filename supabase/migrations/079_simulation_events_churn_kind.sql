-- Migration 079 — persistent persona state v3.
--
-- v1 events were independent: each inbound_ticket stood alone with no
-- thread of cause-and-effect. v3 adds:
--   • 'churn' event kind — a customer leaves (with a final message)
--   • optional chain_id in inbound_ticket payload — ties follow-up
--     tickets back to the originating one
--
-- The 'churn' kind needs to pass the existing CHECK constraint on
-- simulation_events.kind. CHECK constraints can't be ALTERed in
-- Postgres; drop-and-recreate is the only path.

alter table simulation_events
  drop constraint if exists simulation_events_kind_check;

alter table simulation_events
  add constraint simulation_events_kind_check
  check (kind in (
    'inbound_ticket',
    'agent_action',
    'approval_gate',
    'kpi_snapshot',
    'failure',
    'note',
    'churn'
  ));

-- Index for chain lookups (UI groups events by chain_id) — JSON path
-- index works fine even on tiny tables; cheap insurance.
create index if not exists simulation_events_chain_idx
  on simulation_events((payload->>'chain_id'))
  where payload ? 'chain_id';

comment on constraint simulation_events_kind_check on simulation_events is
  'Kind taxonomy. v3 (PR #381) adds churn — fires when a persona walks away.';
