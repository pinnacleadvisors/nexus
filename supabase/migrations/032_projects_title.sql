-- 032_projects_title.sql
--
-- Formalises the `projects.name` → `projects.title` rename. The live DB
-- (the source `npx supabase gen types --linked` reads against) has `title`,
-- but migration 002 still creates the column as `name` — so a fresh DB
-- doesn't match the regenerated types and `app/api/projects/route.ts`
-- couldn't compile. Idempotent: handles every possible state.
--
--   - column already named `title` → no-op
--   - column named `name`          → RENAME TO title
--   - both columns exist (drift)   → drop name (its data should already
--                                     be in title from a previous hand-fix)
--   - neither exists               → ADD title NOT NULL DEFAULT ''

do $$
declare
  has_name  boolean;
  has_title boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects' and column_name = 'name'
  ) into has_name;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects' and column_name = 'title'
  ) into has_title;

  if has_name and not has_title then
    execute 'alter table projects rename column name to title';
  elsif has_name and has_title then
    -- Drift: both columns. Trust title (canonical), drop name.
    execute 'alter table projects drop column name';
  elsif not has_name and not has_title then
    execute 'alter table projects add column title text not null default ''Untitled''';
  end if;
end$$;

comment on column projects.title is
  'Display title. Renamed from `name` in migration 032. The /api/projects route still accepts/returns `name` on the wire for back-compat.';
