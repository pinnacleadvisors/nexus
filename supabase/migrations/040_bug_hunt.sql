-- 040_bug_hunt — operator-gated autonomous bug-hunt loop (task_plan-bug-hunt-loop.md).
--
-- Two tables:
--   bug_hunt_sessions — one row per loop session, holds budget config + state
--   bug_hunt_findings — one row per bug the loop has identified
--
-- Scope partitioning matches chat_sessions: 'admin' for platform-copilot's
-- loop (the only loop scope in v1). Per-business loops are a follow-up.

create extension if not exists "uuid-ossp";

create table if not exists public.bug_hunt_sessions (
  id                      text          primary key,                -- 'bh-<iso-date>-<scope>-<seq>'
  user_id                 text          not null,
  scope                   text          not null,
  status                  text          not null default 'active',  -- 'active' | 'paused' | 'stopped' | 'done'

  -- Primary budget — % of the 5h rolling Claude Max plan window the loop may consume.
  -- Aggressive default per operator choice — leaves 67% for interactive chat.
  plan_window_share_pct   numeric(5,2)  default 33.00,
  -- Mirror for codex / Pro plan (Playwright smoke tests).
  codex_window_share_pct  numeric(5,2)  default 33.00,
  -- Belt-and-braces: refuse to start if resolveClawConfig would fall through to API billing.
  force_plan_window       boolean       default true,

  -- Fallback budget — only consulted when force_plan_window=false.
  budget_usd              numeric(6,2)  default 5.00,
  spent_usd               numeric(6,2)  default 0.00,

  max_iterations          integer       default 20,
  iteration_count         integer       default 0,
  created_at              timestamptz   not null default now(),
  ended_at                timestamptz,

  constraint bug_hunt_sessions_status_check
    check (status in ('active', 'paused', 'stopped', 'done')),
  constraint bug_hunt_sessions_scope_check
    check (scope = 'admin' or scope like 'business:%')
);

create index if not exists bug_hunt_sessions_user_active_idx
  on public.bug_hunt_sessions (user_id, scope, status, created_at desc);

create table if not exists public.bug_hunt_findings (
  id            uuid          primary key default uuid_generate_v4(),
  session_id    text          not null references public.bug_hunt_sessions(id) on delete cascade,
  iteration     integer       not null,
  severity      text          not null default 'p2',     -- 'p0' | 'p1' | 'p2' | 'p3'
  category      text          not null,                  -- 'static' | 'smoke' | 'semantic'
  title         text          not null,
  detail        text,
  source_path   text,                                    -- file:line or URL where found
  status        text          not null default 'open',   -- 'open' | 'pr-opened' | 'merged' | 'wont-fix'
  pr_url        text,
  branch        text,
  created_at    timestamptz   not null default now(),
  resolved_at   timestamptz,

  constraint bug_hunt_findings_severity_check check (severity in ('p0', 'p1', 'p2', 'p3')),
  constraint bug_hunt_findings_category_check check (category in ('static', 'smoke', 'semantic')),
  constraint bug_hunt_findings_status_check   check (status   in ('open', 'pr-opened', 'merged', 'wont-fix'))
);

create index if not exists bug_hunt_findings_session_idx
  on public.bug_hunt_findings (session_id, status, severity);

alter table public.bug_hunt_sessions enable row level security;
alter table public.bug_hunt_findings enable row level security;

drop policy if exists bug_hunt_sessions_service_role on public.bug_hunt_sessions;
create policy bug_hunt_sessions_service_role
  on public.bug_hunt_sessions
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists bug_hunt_findings_service_role on public.bug_hunt_findings;
create policy bug_hunt_findings_service_role
  on public.bug_hunt_findings
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
