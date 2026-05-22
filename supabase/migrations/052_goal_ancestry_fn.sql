-- 052_goal_ancestry_fn.sql
--
-- Phase 4 (Paperclip absorption) — recursive ancestry walk for an issue.
-- Returns the full "why" chain: issue → parent issues → goal → parent goals →
-- business → business.mission. Used by the dispatcher to inject ancestry into
-- agent prompts so every task answers "why am I doing this?" without the
-- agent having to query the graph itself.
--
-- Why a stored function? A recursive CTE walking BOTH issues.parent_id AND
-- goals.parent_goal_id in one round trip beats five separate API calls.
-- Single statement, PgBouncer-safe (same reasoning as 051).
--
-- Returns a JSONB object with shape:
--   {
--     "issue": {"id": ..., "title": ..., "level": 0},
--     "parent_issues": [{"id": ..., "title": ..., "level": 1}, ...],
--     "goal": {"id": ..., "title": ...} | null,
--     "parent_goals": [...],
--     "business": {"slug": ..., "name": ..., "mission": ...}
--   }
--
-- See: docs/research/paperclip-audit-2026-05.md §3 (hierarchy)
--      lib/goals/ancestry.ts (caller)
--      task_plan-paperclip-absorption.md (Task 4d)
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

create or replace function get_issue_ancestry(p_issue_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_result          jsonb;
  v_issue           jsonb;
  v_parent_issues   jsonb;
  v_goal_id         uuid;
  v_goal            jsonb;
  v_parent_goals    jsonb;
  v_business_slug   text;
  v_business        jsonb;
begin
  -- Anchor: the issue itself
  select to_jsonb(i.*) - 'body' - 'execution_run_id' - 'checkout_run_id'
    into v_issue
    from issues i
   where i.id = p_issue_id;

  if v_issue is null then
    return null;
  end if;

  v_goal_id       := (v_issue ->> 'goal_id')::uuid;
  v_business_slug := v_issue ->> 'business_slug';

  -- Parent issues, recursive walk via parent_id. Ordered from immediate
  -- parent outward (closest first).
  with recursive parent_walk as (
    select i.id, i.title, i.parent_id, i.status_category, 1 as depth
      from issues i
     where i.id = (v_issue ->> 'parent_id')::uuid
    union all
    select p.id, p.title, p.parent_id, p.status_category, w.depth + 1
      from issues p
      join parent_walk w on p.id = w.parent_id
     where w.depth < 16   -- bound recursion; pathological chains stop here
  )
  select coalesce(jsonb_agg(to_jsonb(parent_walk.*) order by depth), '[]'::jsonb)
    into v_parent_issues
    from parent_walk;

  -- Goal, if linked
  if v_goal_id is not null then
    select to_jsonb(g.*) - 'success_criteria'   -- success_criteria can be long, fetch separately if needed
      into v_goal
      from goals g
     where g.id = v_goal_id;

    -- Parent goals, recursive walk via parent_goal_id
    with recursive goal_walk as (
      select g.id, g.title, g.parent_goal_id, g.status, 1 as depth
        from goals g
       where g.id = (v_goal ->> 'parent_goal_id')::uuid
      union all
      select pg.id, pg.title, pg.parent_goal_id, pg.status, w.depth + 1
        from goals pg
        join goal_walk w on pg.id = w.parent_goal_id
       where w.depth < 16
    )
    select coalesce(jsonb_agg(to_jsonb(goal_walk.*) order by depth), '[]'::jsonb)
      into v_parent_goals
      from goal_walk;
  else
    v_goal := null;
    v_parent_goals := '[]'::jsonb;
  end if;

  -- Business
  select jsonb_build_object(
           'slug',    b.slug,
           'name',    b.name,
           'niche',   b.niche,
           'mission', b.mission
         )
    into v_business
    from business_operators b
   where b.slug = v_business_slug;

  v_result := jsonb_build_object(
    'issue',         v_issue,
    'parent_issues', v_parent_issues,
    'goal',          v_goal,
    'parent_goals',  v_parent_goals,
    'business',      v_business
  );

  return v_result;
end;
$$;

comment on function get_issue_ancestry(uuid) is
  'Recursive ancestry walk for an issue — returns JSONB with issue + parent_issues + goal + parent_goals + business. Used by dispatcher to inject "why" context into agent prompts. See ADR-007 Task 4d.';
