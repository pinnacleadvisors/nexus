-- Migration 080 — per-operator skill model overrides.
--
-- Skills (.claude/skills/<slug>/SKILL.md) carry an optional `model:`
-- field in the frontmatter that represents the platform-recommended
-- model for that skill. The operator can override per-skill via the
-- /settings → Skills tab; persists in this table.
--
-- Why a separate table (vs writing to SKILL.md)
-- ──────────────────────────────────────────────
-- SKILL.md files are git-tracked. Writing them at runtime would:
--   • drift between deploys (next deploy reverts the operator's choice
--     unless the container has a separate persistent volume)
--   • leak into PRs / git history with no audit trail
--   • break the "skill files are repo source of truth" invariant
-- A dedicated table keeps overrides in the DB (already backed up via
-- the export/import primitive — added to EXPORT_TABLES in PR #388).

create table if not exists skill_overrides (
  user_id     text         not null,
  slug        text         not null,
  model       text         not null,
  rationale   text,                                  -- recorded when set via Recommend
  updated_at  timestamptz  not null default now(),
  primary key (user_id, slug)
);

create index if not exists skill_overrides_user_idx
  on skill_overrides(user_id);

alter table skill_overrides enable row level security;

drop policy if exists skill_overrides_service on skill_overrides;
create policy skill_overrides_service on skill_overrides
  for all to service_role
  using (true) with check (true);

drop policy if exists skill_overrides_user_read on skill_overrides;
create policy skill_overrides_user_read on skill_overrides
  for select to authenticated
  using (user_id = current_setting('request.jwt.claims', true)::jsonb ->> 'sub');

comment on table skill_overrides is
  'Per-operator model override per skill slug (PR #388). Layered with SKILL.md frontmatter model field — override wins when present.';
