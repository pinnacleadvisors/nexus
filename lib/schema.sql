-- Nexus — Supabase schema
-- Run this in the Supabase SQL editor to create the required tables.
-- After running, ensure RLS policies are configured for your Clerk user IDs.

-- ── Agents ────────────────────────────────────────────────────────────────────
create table if not exists agents (
  id          text primary key,
  name        text        not null,
  status      text        not null default 'idle'  check (status in ('active','idle','error')),
  tasks_completed integer not null default 0,
  tokens_used bigint      not null default 0,
  cost_usd    numeric(12,4) not null default 0,
  error_count integer     not null default 0,
  last_active timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- Enable realtime for the agents table
alter publication supabase_realtime add table agents;

-- ── Revenue events (Stripe webhook writes here) ───────────────────────────────
create table if not exists revenue_events (
  id          uuid primary key default gen_random_uuid(),
  amount_usd  numeric(12,2) not null,
  source      text not null default 'stripe' check (source in ('stripe','manual')),
  description text,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists revenue_events_created_at on revenue_events (created_at desc);

-- ── Token events (agent API calls logged here) ────────────────────────────────
create table if not exists token_events (
  id            uuid primary key default gen_random_uuid(),
  agent_id      text references agents(id) on delete set null,
  model         text not null,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd      numeric(12,6) not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists token_events_agent_id   on token_events (agent_id);
create index if not exists token_events_created_at on token_events (created_at desc);

-- ── Alert thresholds ─────────────────────────────────────────────────────────
create table if not exists alert_thresholds (
  id          uuid primary key default gen_random_uuid(),
  metric      text not null check (metric in ('daily_cost','error_rate','agent_down')),
  threshold   numeric(12,2) not null,
  channel     text not null default 'email' check (channel in ('email','slack')),
  destination text not null,          -- email address or Slack webhook URL
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);
