-- Migration 077 — flexible metadata on issues.
--
-- Used by the platform-dev-loop autonomous agent (PR #378) to record:
--   metadata.pr_url            — the draft PR the agent opened
--   metadata.branch            — the feature branch name
--   metadata.dispatched_at     — when the cron / API kicked the agent
--   metadata.agent_session_id  — claude-gateway session for audit
--
-- Generic jsonb so future agents can add their own fields without
-- another migration.

alter table issues
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists issues_metadata_pr_url_idx
  on issues((metadata->>'pr_url'))
  where metadata ? 'pr_url';

comment on column issues.metadata is
  'Free-form jsonb. Platform-dev-loop stores pr_url + branch + dispatched_at here.';
