-- 051_issue_checkout_fn.sql
--
-- Phase 4 (Paperclip absorption) — atomic issue checkout via stored function.
--
-- Why a stored function? PgBouncer transaction pooling does NOT span statement
-- boundaries — `BEGIN; SELECT ... FOR UPDATE SKIP LOCKED; UPDATE ...; COMMIT`
-- from the JS client breaks because PgBouncer can swap connections between
-- statements. A stored function runs in an implicit single-statement
-- transaction, so the row lock is held end-to-end.
--
-- This sidesteps the "PgBouncer + FOR UPDATE" spike called out in the
-- task plan §11.1 entirely.
--
-- Semantics:
--   * Atomically picks ONE claimable issue for (business_slug)
--   * Claimable = checkout_run_id IS NULL AND status_category IN
--     ('unstarted','backlog','triage')
--   * Sets checkout_run_id = p_run_id, execution_run_id = p_run_id,
--     status_category = 'started'
--   * Returns the claimed issue's id, or NULL if no claimable issue exists
--   * Two parallel callers receive different issues (or one returns NULL)
--     thanks to FOR UPDATE SKIP LOCKED
--
-- See: docs/research/paperclip-audit-2026-05.md §2 (checkoutRunId/executionRunId)
--      lib/issues/checkout.ts (caller)
--      task_plan-paperclip-absorption.md (Task 4c)
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

create or replace function claim_issue(
  p_business_slug text,
  p_run_id        uuid,
  p_agent_slug    text default null
) returns uuid
language plpgsql
as $$
declare
  v_issue_id uuid;
begin
  -- Pick the oldest claimable issue. ORDER BY created_at means FIFO; future
  -- prioritisation can extend this. LIMIT 1 + SKIP LOCKED is the standard
  -- worker-queue pattern.
  select id
    into v_issue_id
    from issues
   where business_slug = p_business_slug
     and checkout_run_id is null
     and status_category in ('unstarted','backlog','triage')
   order by created_at asc
   for update skip locked
   limit 1;

  if v_issue_id is null then
    return null;
  end if;

  update issues
     set checkout_run_id  = p_run_id,
         execution_run_id = p_run_id,
         status_category  = 'started',
         status           = coalesce(
                              -- preserve a non-default per-team label if set
                              case when status not in ('Backlog','Todo','Triage') then status end,
                              'In Progress'
                            ),
         assignee_agent   = coalesce(assignee_agent, p_agent_slug),
         updated_at       = now()
   where id = v_issue_id;

  return v_issue_id;
end;
$$;

comment on function claim_issue(text, uuid, text) is
  'Atomically claim one issue for a business via SELECT ... FOR UPDATE SKIP LOCKED. Returns the claimed issue id or NULL. See ADR-007 / Paperclip absorption Task 4c.';

-- Release helper — call when a run finishes/aborts without completing the
-- issue so other agents can pick it up.
create or replace function release_issue(
  p_issue_id uuid,
  p_run_id   uuid
) returns boolean
language plpgsql
as $$
declare
  v_updated integer;
begin
  update issues
     set checkout_run_id  = null,
         execution_run_id = null,
         status_category  = 'unstarted',
         status           = 'Todo',
         updated_at       = now()
   where id = p_issue_id
     and checkout_run_id = p_run_id;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

comment on function release_issue(uuid, uuid) is
  'Release a claimed issue. Only the holding run can release (run_id check). Returns true on success, false if the run does not hold the lock.';
