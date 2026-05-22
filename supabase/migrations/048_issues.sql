-- 048_issues.sql
--
-- Phase 2 (Paperclip absorption) — threaded issues with single-assignee +
-- checkout/execution lock semantics. Plus issue_comments for threading.
--
-- See: docs/research/paperclip-audit-2026-05.md §2 (schema invariants)
--      docs/research/paperclip-audit-2026-05.md §3 (hierarchy)
--      docs/adr/007-paperclip-absorption.md
--      task_plan-paperclip-absorption.md (Task 2c)
--      lib/issues/checkout.ts (atomic claim helper using these columns)
--
-- Invariants enforced (per Paperclip doc/execution-semantics.md):
--   * single assignee: assignee_agent and assignee_user mutually exclusive
--   * status_category constrains status (triage|backlog|unstarted|started|completed|cancelled)
--   * checkout_run_id is the issue-ownership lock; execution_run_id is the active-run pointer
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; CREATE INDEX IF NOT EXISTS;
-- DROP POLICY IF EXISTS / CREATE POLICY.
--
-- Paired helper: lib/issues/insert.ts (graceful-degrade insert)
-- Paired helper: lib/issues/checkout.ts (atomic claim via SELECT ... FOR UPDATE SKIP LOCKED)

create table if not exists issues (
  id                  uuid          primary key default gen_random_uuid(),
  business_slug       text          not null
                                    references business_operators(slug) on delete cascade,
  goal_id             uuid          null
                                    references goals(id) on delete set null,
  parent_id           uuid          null
                                    references issues(id) on delete set null,

  -- Single-assignee invariant
  assignee_agent      text          null,
  assignee_user       text          null,
  constraint issues_single_assignee
    check (
      (assignee_agent is null and assignee_user is null) or
      (assignee_agent is not null and assignee_user is null) or
      (assignee_agent is null and assignee_user is not null)
    ),

  -- Status — status_category is the fixed taxonomy; status is the per-team label.
  -- Defaults match a fresh "backlog" issue.
  status_category     text          not null default 'backlog'
                                    check (status_category in
                                      ('triage','backlog','unstarted','started','completed','cancelled')),
  status              text          not null default 'Backlog',

  title               text          not null,
  body                text          null,

  -- Execution locks (per Paperclip doc/execution-semantics.md §5).
  -- checkout_run_id holds the issue-ownership lock for the current agent run.
  -- execution_run_id holds the currently-active run pointer.
  checkout_run_id     uuid          null,                            -- FK enforced at app layer (runs table varies)
  execution_run_id    uuid          null,

  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now()
);

create index if not exists issues_business_slug_idx
  on issues(business_slug);
create index if not exists issues_parent_idx
  on issues(parent_id)
  where parent_id is not null;
create index if not exists issues_goal_idx
  on issues(goal_id)
  where goal_id is not null;
create index if not exists issues_status_idx
  on issues(business_slug, status_category);
-- Index for the atomic-checkout query (lib/issues/checkout.ts):
--   WHERE business_slug = ? AND status_category IN ('unstarted','backlog') AND checkout_run_id IS NULL
create index if not exists issues_claimable_idx
  on issues(business_slug, status_category)
  where checkout_run_id is null;

create or replace function issues_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists issues_updated_at on issues;
create trigger issues_updated_at
  before update on issues
  for each row execute function issues_set_updated_at();

alter table issues enable row level security;

drop policy if exists issues_service_role_all on issues;
create policy issues_service_role_all on issues
  for all using (true) with check (true);

-- Issue comments — threaded discussion under an issue. Comments can belong
-- to either an agent or a user (same single-author invariant as issues).

create table if not exists issue_comments (
  id            uuid          primary key default gen_random_uuid(),
  issue_id      uuid          not null
                              references issues(id) on delete cascade,
  author_agent  text          null,
  author_user   text          null,
  constraint issue_comments_single_author
    check (
      (author_agent is not null and author_user is null) or
      (author_agent is null and author_user is not null)
    ),
  body          text          not null,
  created_at    timestamptz   not null default now()
);

create index if not exists issue_comments_issue_idx
  on issue_comments(issue_id, created_at);

alter table issue_comments enable row level security;

drop policy if exists issue_comments_service_role_all on issue_comments;
create policy issue_comments_service_role_all on issue_comments
  for all using (true) with check (true);

comment on table issues is
  'Threaded units of work, single-assignee, with checkout/execution lock semantics. Per ADR-007 / Paperclip absorption.';
comment on column issues.checkout_run_id is
  'Issue-ownership lock for the current agent run. Set by lib/issues/checkout.ts via SELECT ... FOR UPDATE SKIP LOCKED. Distinct from execution_run_id which points at the live run.';
comment on column issues.execution_run_id is
  'Pointer to the currently-active run for this issue. NULL when work is paused or between heartbeats.';
comment on column issues.status_category is
  'Fixed taxonomy: triage|backlog|unstarted|started|completed|cancelled. Drives lifecycle transitions; mirrors Paperclip doc/TASKS.md categories.';
comment on column issues.status is
  'Per-team label within status_category (e.g. "In Review" under "started"). Free-text — the category does the lifecycle work.';
comment on table issue_comments is
  'Threaded discussion under an issue. Authored by either an agent or a user (XOR).';
