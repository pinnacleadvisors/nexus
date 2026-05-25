-- 059_operator_tasks_explanation — cache an in-depth setup guide per task.
--
-- The inbox surface (components/inbox/InboxClient.tsx) renders an "Explain"
-- button next to each task's "Done" button. Clicking it calls a new route
-- (POST /api/views/tasks/:id/explain) that asks the active LLM for a
-- step-by-step setup walkthrough based on the task's title + description.
--
-- We cache the result on the row so re-clicks are instant (and free): a
-- nullable `explanation` text column plus a `explanation_generated_at`
-- timestamp so callers can decide when to invalidate (e.g. UI may offer
-- "regenerate" if the cached guide is older than 30 days and the title
-- has changed since).
--
-- Idempotent: every statement uses `if not exists`.

alter table public.operator_tasks
  add column if not exists explanation              text,
  add column if not exists explanation_generated_at timestamptz;

-- No index — the explain payload is fetched by row id (already pk-indexed).
-- Adding a fulltext index would be wasted IO; we don't search guides.
