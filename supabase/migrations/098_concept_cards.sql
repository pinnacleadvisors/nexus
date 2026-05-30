-- 098_concept_cards.sql — allow kind='concept' lessons on the /learn deck.
--
-- Concept cards are platform-internals explainers (how an LLM works, the
-- harness h2–h5 layers, what a skill / sub-harness / agent is) that teach the
-- operator the concepts the agents embody — distinct from atom-fact recall.
-- They ride the same FSRS scheduler + Feynman grader (the lesson body lives in
-- the existing `reference_context` column, so no new columns are needed).
--
-- Additive + idempotent: drop-then-add the kind CHECK so re-running is a no-op
-- and existing rows are untouched.

alter table flashcards drop constraint if exists flashcards_kind_check;
alter table flashcards add constraint flashcards_kind_check
  check (kind in ('flip', 'cloze', 'multiple-choice', 'feynman', 'concept'));
