Goal: Give the operator a Duolingo-style daily learning surface, on top of the molecular memory graph, that keeps them fluent in their own platform as it grows.

Success criteria:
- A new `/learn` route exists at `app/(protected)/learn/` with a Duolingo-shaped path UI: each `memory/molecular/mocs/<topic>.md` is a unit; the atoms linked from it are lessons; mastery is shown as a 5-tier crown ring around each lesson node.
- A daily review session (`/learn/session`) pulls the next-due cards across MOCs (interleaving), supports four card kinds — cloze, flip Q&A, multiple-choice, and Feynman-explain — and grades free-text explanations through Claude.
- Spaced repetition uses FSRS-4 (open-source, modern) with per-card stability + difficulty + retrievability stored in Supabase. Cards transition through New → Learning → Review → Relearning states.
- A daily streak counter (with up to 2 freeze tokens, like Duolingo's "streak freeze") persists across sessions; XP earned per review increments a daily/weekly bar.
- A stats overview (`/learn/stats`) shows: streak with calendar heatmap, total cards reviewed, retention rate per MOC, mastery distribution, weakest atoms surfaced for next session, and stale-knowledge alerts when an atom's source file changed since the last review.
- Cards are auto-generated from `mol_atoms` rows: each atom yields a flip Q&A automatically and may yield 1+ cloze cards (Claude picks the best blanks); MOCs yield "navigation" multiple-choice cards. A nightly cron `/api/cron/sync-learning-cards` keeps the deck fresh as atoms are added/edited.
- `npx tsc --noEmit` passes; new components have `'use client'` where needed; new routes use `auth()` and rate limiting; stack rules in `memory/platform/STACK.md` are followed.

Hard constraints:
- The molecular memory graph is the source of truth. Cards are derived; never edit atoms from `/learn`. If an atom is deleted, its derived cards are soft-deleted (not destroyed — review history kept for stats).
- Single-owner platform. Tables have `user_id` for future multi-user but `proxy.ts` ALLOWED_USER_IDS gates access. RLS deny-by-default; service-role only for the cron job.
- Atom auto-sync must be idempotent and SHA-aware: if `mol_atoms.sha` is unchanged, cards aren't regenerated; if it changes, derived cards are reset to the Learning state with a `staleReason`.
- No new Anthropic spend on every review — Feynman grading is the only Claude call in the hot path; cap at 1 grade per minute per user via `lib/ratelimit.ts`. All other card generation happens in the cron, not in the user request.
- Each task below fits one Write/Edit call under the 300-line write-size hook limit.
- Branch: `claude/evaluate-learning-system-WuPd5`. Open as draft PR when pushed.

---

## Phase 1 — Explore (findings)

### What already exists

- `memory/molecular/atoms/<slug>.md` — frontmatter has `title`, `id`, `created`, `sources`, `links`, `status`, `lastAccessed`, `accessCount`. Body is a single paragraph fact + optional `## Related` section.
- `memory/molecular/mocs/<slug>.md` — Maps of Content with `[[wikilinks]]` to atoms + entities.
- `supabase/migrations/021_molecular_mirror.sql` already mirrors the graph to `mol_atoms`, `mol_entities`, `mol_mocs`, etc. with `(scope_id, slug)` PK, `body_md`, `frontmatter` JSONB, `sha`, `embedding vector(1536)`. Reads come from this mirror, not the filesystem at runtime.
- `proxy.ts` — Clerk middleware, `ALLOWED_USER_IDS` allow-list. Single-user model.
- `lib/supabase.ts` — `createServiceClient()` for server writes, `createClient()` for browser reads.
- `lib/ratelimit.ts` — Upstash Redis with in-memory fallback; existing `ratelimit.api(userId)` shape.
- `lib/types.ts` — single shared types file. Existing patterns: string-literal unions; camelCase fields.
- `app/api/chat/route.ts` — reference for how to call Anthropic with `streamText`. Feynman grader will use `generateText`.
- `components/layout/Sidebar.tsx` — five-icon top-level nav; adding "Learn" requires a 1-line entry + an icon.
- `app/globals.css` design tokens: space-950..500 surfaces, `--color-purple` accent, `--color-revenue` success, `--color-warning` streak gold.

### Gaps to close

- No `flashcards` / `flashcard_reviews` / `learning_sessions` / `daily_streaks` tables.
- No FSRS scheduler in `lib/`.
- No `/learn/*` pages or `/api/learn/*` routes.
- No atom-to-card generator; nightly `/api/cron/rebuild-graph` exists but doesn't materialise cards.

### Risks

- **Auto-cloze quality.** Naive blanking picks ambiguous spans. Mitigation: cron uses Claude Haiku to pick blanks; cap 50 atoms/run; fallback to flip-only if grader fails.
- **FSRS correctness.** Off-by-one in stability decay = wrong intervals. Mitigation: port from FSRS-4 reference (Apache-2.0) + small test harness.
- **Stale knowledge.** If an atom's body changes, old reviews mislead. Mitigation: cron compares `mol_atoms.sha` against `flashcards.source_sha`; on mismatch soft-reset card + flag `staleReason`.
- **Single-user assumption.** Tables carry `user_id` from the start to avoid migration when ALLOWED_USER_IDS expands.

## Phase 2 — Plan (atomic tasks)

### Step 1 — Foundation

- **T1a** `lib/types.ts` — append `CardKind`, `ReviewRating`, `CardState`, `Flashcard`, `FlashcardReview`, `LearningSession`, `DailyStreak`, `LearnPathUnit`, `LearnPathLesson`, `LearnStats`. Parallel: yes.
- **T1b** `supabase/migrations/023_learning_system.sql` — 4 tables (`flashcards`, `flashcard_reviews`, `learning_sessions`, `daily_streaks`), indexes on `(user_id, due_at)` + `(user_id, state)`, RLS deny-by-default. Parallel: yes.
- **T1c** `lib/learning/fsrs.ts` — pure-TS FSRS-4 port: `schedule(card, rating, now) -> { nextDueAt, stability, difficulty, state }`. Parallel: yes.
- **T1d** `lib/learning/types.ts` — internal types not worth sharing globally (e.g. `FsrsParams`). Parallel: yes.

Verify: `npx tsc --noEmit` passes with new types only.

### Step 2 — Card generation + sync

- **T2a** `lib/learning/card-generator.ts` — `flipFromAtom`, `clozeFromAtom`, `mcFromMoc`, `feynmanFromAtom`. Returns `Flashcard[]`. Parallel: yes.
- **T2b** `lib/learning/atom-sync.ts` — `syncCardsFromMolecular(userId)`: diffs `mol_atoms.sha` against `flashcards.source_sha`. Parallel: no (depends on T2a).
- **T2c** `app/api/cron/sync-learning-cards/route.ts` — Vercel cron auth (`CRON_SECRET`); calls `syncCardsFromMolecular`. Parallel: no.

Verify: `curl -X POST -H 'Authorization: Bearer $CRON_SECRET' /api/cron/sync-learning-cards` materialises one card per atom.

### Step 3 — Session API

- **T3a** `app/api/learn/session/route.ts` — `GET`: 10 due cards, interleaved across MOCs (round-robin); falls back to weakest by retrievability. Parallel: yes.
- **T3b** `app/api/learn/review/route.ts` — `POST { cardId, rating, durationMs, answer? }`: writes review, runs FSRS, updates card + XP + streak. Parallel: yes.
- **T3c** `app/api/learn/grade-feynman/route.ts` — `POST { cardId, explanation }`; rate-limited 1/min/user; calls Claude Haiku; returns `{ score, feedback, suggestedRating }`. Parallel: yes.
- **T3d** `app/api/learn/stats/route.ts` — `GET`: streak, calendar heatmap (90d), retention per MOC, mastery histogram, top 5 weakest atoms. Parallel: yes.

Verify: `curl /api/learn/session` returns up to 10 cards; `POST /api/learn/review` updates `due_at`.

### Step 4 — UI: Duolingo path + session + stats

- **T4a** `app/(protected)/learn/layout.tsx` — top header showing streak + XP. Parallel: yes.
- **T4b** `app/(protected)/learn/page.tsx` — fetches stats + path; renders `<PathView>` and "Start review" CTA. Parallel: yes.
- **T4c** `app/(protected)/learn/session/page.tsx` — drives card-by-card flow; ends with `<SessionResults>`. Parallel: yes.
- **T4d** `app/(protected)/learn/stats/page.tsx` — fetches `/api/learn/stats`; renders streak heatmap + retention bars + weakest atoms. Parallel: yes.
- **T4e** `components/learn/PathView.tsx` — vertical, snake-shaped path; each unit is a section header, each lesson a circular node. Parallel: yes.
- **T4f** `components/learn/LessonNode.tsx` — circular SVG node with mastery ring (5 segments). Parallel: yes.
- **T4g** `components/learn/ReviewCard.tsx` — switch on `card.kind` -> Cloze / Flip / MC / Feynman. Parallel: yes.
- **T4h** `components/learn/ClozeCard.tsx` — input + reveal + Again/Hard/Good/Easy bar. Parallel: yes.
- **T4i** `components/learn/FlipCard.tsx` — front (question), tap to flip, then rating bar. Parallel: yes.
- **T4j** `components/learn/MultipleChoiceCard.tsx` — 4 options, immediate feedback. Parallel: yes.
- **T4k** `components/learn/FeynmanCard.tsx` — textarea + grade button; shows score + feedback. Parallel: yes.
- **T4l** `components/learn/StreakBadge.tsx` — flame icon + day count + freezes-remaining. Parallel: yes.
- **T4m** `components/learn/XpBar.tsx` — daily XP toward goal (default 30 XP/day). Parallel: yes.
- **T4n** `components/learn/SessionResults.tsx` — end-of-session summary. Parallel: yes.
- **T4o** `components/learn/CalendarHeatmap.tsx` — 90-day grid, GitHub-style. Parallel: yes.

Verify: visit `/learn` in dev; click "Start review"; step through one of each card kind; finish on results; visit `/learn/stats`.

### Step 5 — Wiring + memory hygiene

- **T5a** `components/layout/Sidebar.tsx` — add `{ type: 'link', href: '/learn', label: 'Learn', icon: Brain }`.
- **T5b** `memory/platform/ARCHITECTURE.md` — register `/learn/*` + `lib/learning/` + new tables.
- **T5c** `memory/roadmap/SUMMARY.md` + `memory/roadmap/PENDING.md` — add Phase 23 row.
- **T5d** `ROADMAP.md` — add Phase 23 section.
- **T5e** `vercel.json` — add `/api/cron/sync-learning-cards` daily cron.

Verify: `npx tsc --noEmit` passes; `/learn` link visible in the sidebar; PR description references Phase 23.

### Step 6 — Manual tasks (user)

These are flagged in the final PR comment so you can do them before merge:

- Apply migration 023: `npm run migrate` (or run the SQL in Supabase Studio).
- Set `OWNER_USER_ID` in Doppler to the owner's Clerk user ID (used by the cron).
- Confirm `CRON_SECRET` is set so Vercel cron can hit the sync endpoint.
- Optionally tune `LEARN_DAILY_GOAL_XP` (default 30).

## Phase 3 — Implement

(progress tracked in `## Progress` at the bottom)

## Progress (as of 2026-04-30)

### Completed
- [ ] T1a–T1d Foundation
- [ ] T2a–T2c Card generation + sync
- [ ] T3a–T3d Session API
- [ ] T4a–T4o UI
- [ ] T5a–T5e Wiring

### Remaining
All tasks pending — implementation starts in this PR.

### Blockers / Open Questions
- None.
