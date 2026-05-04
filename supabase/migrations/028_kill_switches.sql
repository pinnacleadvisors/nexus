-- 027_kill_switches.sql
--
-- Hot-reloadable kill switches that gate every dangerous boundary in Nexus.
-- The cloud-native equivalent of the Mission Control Kit's `.env`-mtime guard:
-- a single Postgres row per switch, owner-only writes, 60-second cache in
-- `lib/kill-switches.ts`. Flipping a switch propagates within ~60 s.
--
-- Read-path: any request can read; cache hides the latency.
-- Write-path: gated by app code (owner-only via ALLOWED_USER_IDS) and by RLS
-- (service role only). Every flip is audited via `lib/audit.ts`.
--
-- The six default switches mirror Pack 02 of the kit, mapped to Nexus
-- equivalents:
--   llm_dispatch        — gates lib/claw/llm.ts::callClaude (every LLM call)
--   auto_assign         — gates n8n-strategist + Router auto-routing
--   scheduler           — gates Inngest cron functions (skip claim if false)
--   dashboard_mutations — gates POST/PUT/DELETE on protected dashboard routes
--   slack_warroom       — gates /standup, /discuss, /ask Slack slash commands
--   swarm_consensus     — gates lib/swarm/Consensus.ts validator runs

create table if not exists kill_switches (
  key          text primary key,
  enabled      boolean not null default true,
  description  text not null,
  updated_at   timestamptz not null default now(),
  updated_by   text
);

comment on table kill_switches is
  'Hot-reloadable feature gates. Flip enabled=false to refuse the boundary in ~60s.';
comment on column kill_switches.key is
  'Stable identifier — referenced by lib/kill-switches.ts::isEnabled(key).';
comment on column kill_switches.updated_by is
  'Clerk user_id that last toggled this switch. Audited via audit_log.';

-- Touch trigger keeps updated_at honest on any mutation.
create or replace function kill_switches_touch() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists kill_switches_touch on kill_switches;
create trigger kill_switches_touch
  before update on kill_switches
  for each row execute function kill_switches_touch();

-- Seed the six default switches (idempotent — won't override existing values).
insert into kill_switches (key, enabled, description) values
  ('llm_dispatch',        true, 'Gates every LLM call through lib/claw/llm.ts::callClaude. Flip false to refuse all LLM dispatches.'),
  ('auto_assign',         true, 'Gates n8n-strategist auto-routing + Router bandit picks. Flip false to refuse auto agent assignment.'),
  ('scheduler',           true, 'Gates Inngest cron + scheduled-task fan-out. Flip false to skip all cron-claimed work.'),
  ('dashboard_mutations', true, 'Gates POST/PUT/DELETE on protected dashboard routes. Flip false for read-only dashboard mode.'),
  ('slack_warroom',       true, 'Gates /standup, /discuss, /ask war-room slash commands. Flip false to refuse multi-agent fan-out.'),
  ('swarm_consensus',     true, 'Gates lib/swarm/Consensus.ts validator runs. Flip false to skip validator passes (fast-path only).')
on conflict (key) do nothing;

-- RLS: only the service role can read/write. App code uses createServerClient()
-- (service role) to read; UI POSTs through /api/kill-switches/route.ts which
-- itself enforces ALLOWED_USER_IDS owner check.
alter table kill_switches enable row level security;

drop policy if exists kill_switches_service_only on kill_switches;
create policy kill_switches_service_only on kill_switches
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
