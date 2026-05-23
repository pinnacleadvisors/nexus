-- 054_background_task_parent_id — swarm sub-task linkage.
--
-- Phase 5 of task_plan-collaborative-chat.md. A swarm is N parallel
-- background tasks with a single parent — the agent emits a `swarm-task`
-- block which the poll route fans out into one parent row + N child rows.
-- The parent row represents the swarm-as-a-whole (status reflects the
-- aggregate); children carry the actual `kind` + `payload` per sub-agent.
--
-- ON DELETE CASCADE: deleting the parent removes all children too. The
-- operator clears a swarm by cancelling/deleting the parent, not each
-- child individually.

alter table public.background_tasks
  add column if not exists parent_id uuid
  references public.background_tasks(id) on delete cascade;

create index if not exists background_tasks_parent_idx
  on public.background_tasks (parent_id)
  where parent_id is not null;
