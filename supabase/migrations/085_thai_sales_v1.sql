-- 085 — thai_sales v1 schema (Slice 0 of task_plan-thai-sales-agency.md).
--
-- Three tables hanging off the existing Run state machine. One Prospect =
-- one Run. The Run carries the sales-pipeline RunPhase values (discover →
-- outreach → booked → call → close); the Prospect row carries the
-- business-side details (name, website, audit, ACV estimate). Sales calls
-- + proposals hang off the prospect.
--
-- Idempotent — every CREATE / ALTER guarded by IF NOT EXISTS. Re-running
-- against a partially-applied DB is a no-op.
--
-- Migration number 085 was picked to follow the most recent shipped
-- migration (084_fixture_mode_active.sql). Earlier drafts of this plan
-- proposed `019_thai_sales.sql` but that slot is long gone.

-- ── prospects ────────────────────────────────────────────────────────────
create table if not exists prospects (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid not null references runs(id) on delete cascade,
  business_name       text not null,
  website             text,
  contact_email       text,
  audit               jsonb,
  country             text not null default 'TH',
  segment             text,
  value_estimate_usd  numeric(12, 2),
  status              text not null default 'new'
    check (status in ('new', 'contacted', 'replied', 'booked', 'won', 'lost', 'archived')),
  created_at          timestamptz not null default now(),
  owner_user_id       text not null
);

create index if not exists prospects_run_id_idx       on prospects (run_id);
create index if not exists prospects_owner_status_idx on prospects (owner_user_id, status);

comment on table prospects is
  'Thai sales agency v1: one row per business the lead-prospector identified. '
  'FK to runs ties the pipeline state machine. owner_user_id partitions per operator.';

-- ── sales_calls ──────────────────────────────────────────────────────────
create table if not exists sales_calls (
  id                  uuid primary key default gen_random_uuid(),
  prospect_id         uuid not null references prospects(id) on delete cascade,
  heygen_session_id   text,
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  transcript          jsonb,
  outcome             text
    check (outcome in ('qualified', 'not_qualified', 'reschedule', 'no_show'))
);

create index if not exists sales_calls_prospect_id_idx on sales_calls (prospect_id);
create index if not exists sales_calls_started_at_idx  on sales_calls (started_at desc);

comment on table sales_calls is
  'Thai sales agency v1: one row per HeyGen avatar conversation. transcript is '
  'the structured turn-by-turn record the avatar drove. outcome stamped post-call.';

-- ── proposals ────────────────────────────────────────────────────────────
create table if not exists proposals (
  id                    uuid primary key default gen_random_uuid(),
  sales_call_id         uuid not null references sales_calls(id) on delete cascade,
  scope_md              text not null,
  price_usd             numeric(12, 2) not null,
  stripe_checkout_url   text,
  status                text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  approved_by           text,
  approved_at           timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists proposals_sales_call_id_idx on proposals (sales_call_id);
create index if not exists proposals_status_idx        on proposals (status) where status != 'expired';

comment on table proposals is
  'Thai sales agency v1: one row per draft proposal generated after a sales_call. '
  'stripe_checkout_url stays draft until operator approves (status=draft → sent). '
  'Mirrors the 5-category gate matrix: proposal review is a sanctioned approval gate.';

-- ── outreach_messages ────────────────────────────────────────────────────
-- Sent by sdr-agent — kept separate from RunEvent so the audit trail is clean
-- when the operator filters by "prospect-touching mutations".
create table if not exists outreach_messages (
  id            uuid primary key default gen_random_uuid(),
  prospect_id   uuid not null references prospects(id) on delete cascade,
  channel       text not null check (channel in ('email', 'linkedin', 'twitter_dm')),
  subject       text,
  body          text not null,
  sent_at       timestamptz not null default now(),
  external_id   text,
  opened_at     timestamptz,
  replied_at    timestamptz
);

create index if not exists outreach_messages_prospect_id_idx on outreach_messages (prospect_id);

comment on table outreach_messages is
  'Thai sales agency v1: outreach the sdr-agent sent (email via Resend, LinkedIn '
  'via Composio). external_id ties back to the upstream provider for delivery + '
  'open-tracking webhooks.';

-- ── RLS — service-role write, operator-owned read ────────────────────────
alter table prospects          enable row level security;
alter table sales_calls        enable row level security;
alter table proposals          enable row level security;
alter table outreach_messages  enable row level security;

drop policy if exists prospects_service_role         on prospects;
drop policy if exists sales_calls_service_role       on sales_calls;
drop policy if exists proposals_service_role         on proposals;
drop policy if exists outreach_messages_service_role on outreach_messages;

create policy prospects_service_role         on prospects         for all using (auth.role() = 'service_role');
create policy sales_calls_service_role       on sales_calls       for all using (auth.role() = 'service_role');
create policy proposals_service_role         on proposals         for all using (auth.role() = 'service_role');
create policy outreach_messages_service_role on outreach_messages for all using (auth.role() = 'service_role');
