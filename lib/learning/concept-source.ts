/**
 * lib/learning/concept-source.ts — turn the hand-authored concept curriculum
 * into `CardSeed`s for the /learn deck. Pure (no I/O), so it unit-tests
 * without a DB.
 *
 * A concept seed reuses the existing card columns: `front` is the prompt,
 * `referenceContext` carries the lesson body (the Feynman grader's answer key),
 * and `atomSlug` is the synthetic `concept:<slug>` so concept cards de-dupe by
 * lesson and never collide with atom-derived cards.
 */

import { createHash } from 'node:crypto'
import type { CardSeed } from './card-generator'
import { CONCEPT_CURRICULUM } from './concept-curriculum'

/** All concept cards group under this synthetic MOC for the path UI. */
export const CONCEPT_MOC = 'platform-internals'

/** Stable atom_slug for a concept lesson. */
export function conceptAtomSlug(slug: string): string {
  return `concept:${slug}`
}

/** SHA of a lesson body — drives stale detection when a lesson is edited. */
function bodySha(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16)
}

/** Build a `CardSeed` per curriculum lesson. Pure + deterministic. */
export function conceptSeeds(): CardSeed[] {
  return CONCEPT_CURRICULUM.map((lesson) => ({
    kind:             'concept',
    mocSlug:          CONCEPT_MOC,
    atomSlug:         conceptAtomSlug(lesson.slug),
    sourceSha:        bodySha(lesson.body),
    front:            `Explain: ${lesson.title}`,
    back:             lesson.summary,
    referenceContext: lesson.body,
  }))
}
