-- 023_learning_system.sql
--
-- Phase 23: Duolingo-style learning surface on top of the molecular memory
-- graph. Cards are derived from `mol_atoms` + `mol_mocs` (source of truth) by a
-- nightly cron; review history lives here and feeds the FSRS-4 scheduler.
--
-- Single-owner platform today, but every row carries `user_id` so the schema
-- already supports a future ALLOWED_USER_IDS expansion. RLS is deny-by-default;
-- service-role only writes (cron + API routes).

-- ── flashcards ────────────────────────────────────────────────────────────────
create table if not exists flashcards (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null,
  kind            text not null check (kind in ('flip', 'cloze', 'multiple-choice', 'feynman')),
  moc_slug        text,
  atom_slug       text not null,
  source_sha      text not null,
  front           text not null,
  back            text not null,
  options         jsonb,
  reference_context text,
  state           text not null default 'new'
                  check (state in ('new', 'learning', 'review', 'relearning', 'archived')),
  stability       double precision not null default 0,
  difficulty      double precision not null default 5,
  retrievability  double precision not null default 1,
  due_at          timestamptz not null default now(),
  crown           integer not null default 0 check (crown between 0 and 5),
  streak_count    integer not null default 0,
  last_reviewed_at timestamptz,
  stale_reason    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists flashcards_user_due_idx
  on flashcards (user_id, due_at)
  where state <> 'archived';

create index if not exists flashcards_user_state_idx
  on flashcards (user_id, state);

create index if not exists flashcards_atom_idx
  on flashcards (atom_slug);

create index if not exists flashcards_moc_idx
  on flashcards (moc_slug)
  where moc_slug is not null;

create unique index if not exists flashcards_user_atom_kind_idx
  on flashcards (user_id, atom_slug, kind, coalesce(front, ''));

alter table flashcards enable row level security;

create policy flashcards_owner_read
  on flashcards for select
  using (auth.jwt() ->> 'sub' = user_id);

-- ── flashcard_reviews ─────────────────────────────────────────────────────────
create table if not exists flashcard_reviews (
  id              uuid primary key default gen_random_uuid(),
  card_id         uuid not null references flashcards(id) on delete cascade,
  user_id         text not null,
  rating          text not null check (rating in ('again', 'hard', 'good', 'easy')),
  answer          text,
  grade           integer check (grade between 0 and 100),
  grade_feedback  text,
  duration_ms     integer not null default 0,
  xp              integer not null default 0,
  prev_state      text not null,
  new_state       text not null,
  stability_after double precision not null,
  due_at_after    timestamptz not null,
  created_at      timestamptz not null default now()
);

create index if not exists flashcard_reviews_user_created_idx
  on flashcard_reviews (user_id, created_at desc);

create index if not exists flashcard_reviews_card_idx
  on flashcard_reviews (card_id, created_at desc);

alter table flashcard_reviews enable row level security;

create policy flashcard_reviews_owner_read
  on flashcard_reviews for select
  using (auth.jwt() ->> 'sub' = user_id);

-- ── learning_sessions ─────────────────────────────────────────────────────────
create table if not exists learning_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  cards_reviewed  integer not null default 0,
  correct_count   integer not null default 0,
  xp_earned       integer not null default 0,
  avg_duration_ms integer not null default 0
);

create index if not exists learning_sessions_user_started_idx
  on learning_sessions (user_id, started_at desc);

alter table learning_sessions enable row level security;

create policy learning_sessions_owner_read
  on learning_sessions for select
  using (auth.jwt() ->> 'sub' = user_id);

-- ── daily_streaks ─────────────────────────────────────────────────────────────
create table if not exists daily_streaks (
  user_id           text primary key,
  current_streak    integer not null default 0,
  longest_streak    integer not null default 0,
  freezes_available integer not null default 2 check (freezes_available between 0 and 2),
  last_review_date  date,
  xp_today          integer not null default 0,
  xp_total          integer not null default 0,
  updated_at        timestamptz not null default now()
);

alter table daily_streaks enable row level security;

create policy daily_streaks_owner_read
  on daily_streaks for select
  using (auth.jwt() ->> 'sub' = user_id);

-- ── updated_at trigger (mirrors other tables) ─────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists flashcards_updated_at on flashcards;
create trigger flashcards_updated_at
  before update on flashcards
  for each row execute function set_updated_at();

drop trigger if exists daily_streaks_updated_at on daily_streaks;
create trigger daily_streaks_updated_at
  before update on daily_streaks
  for each row execute function set_updated_at();
