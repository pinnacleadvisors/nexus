-- 029_audit_pinning.sql
--
-- Adds Mission Control Kit Pack 03's pinning + 90-day retention to the
-- existing audit_log table. The 90-day prune happens in
-- /api/cron/audit-prune; pinned rows survive the sweep.

alter table audit_log
  add column if not exists pinned boolean not null default false;

comment on column audit_log.pinned is
  'When true, /api/cron/audit-prune leaves this row alone. Use for incident reconstruction artifacts.';

-- Speed up the prune query: WHERE pinned = false AND created_at < cutoff.
create index if not exists audit_log_prune_idx
  on audit_log (created_at) where pinned = false;
