-- 102 — life_domains + life_habit_log: the Business-OS → Life-OS spine.
--
-- A life_domain is a NON-revenue operator domain (Health is the first). It
-- deliberately has NO revenue / kpi_targets / approval_gates columns — life
-- domains never route through checkKillSwitch or revenue aggregation (that's
-- the hard constraint from the Gamify-LifeOS plan). It reuses the daily-streak
-- gamification primitives, not the business machinery.
--
-- life_habit_log is one row per (user, domain, day) — the streak engine
-- generalised from flashcard review to arbitrary daily events.
--
-- Idempotent. Deny-by-default RLS (service-role only).

create table if not exists life_domains (
  slug        text        not null,
  user_id     text        not null,
  kind        text        not null default 'life',
  label       text        not null,
  status      text        not null default 'active',
  created_at  timestamptz not null default now(),
  primary key (user_id, slug)
);

comment on table life_domains is
  'Non-revenue operator domains (Health first). NO kpi/revenue columns by '
  'design — life domains bypass the business/cost-guard machinery.';

create table if not exists life_habit_log (
  user_id     text        not null,
  domain_slug text        not null,
  day         date        not null,
  payload     jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  primary key (user_id, domain_slug, day)
);

comment on table life_habit_log is
  'One row per (operator, life-domain, day) — the daily-streak engine '
  'generalised from flashcard review to arbitrary habit events.';

create index if not exists life_habit_log_user_domain_idx
  on life_habit_log (user_id, domain_slug);

alter table life_domains   enable row level security;
alter table life_habit_log enable row level security;

drop policy if exists life_domains_service_role   on life_domains;
drop policy if exists life_habit_log_service_role on life_habit_log;
create policy life_domains_service_role   on life_domains   for all using (auth.role() = 'service_role');
create policy life_habit_log_service_role on life_habit_log for all using (auth.role() = 'service_role');
