/**
 * lib/learning/concept-sync.ts — upsert the concept curriculum into a user's
 * /learn deck. Self-contained (does NOT touch syncCardsFromMolecular's atom
 * reconcile / orphan-archival), so concept cards can never be archived as
 * "orphan atoms" — they have synthetic `concept:<slug>` atom_slugs.
 *
 * Called alongside the atom sync from the `sync-learning-cards` cron. Idempotent:
 * a lesson whose body is unchanged is skipped; an edited lesson resets the card
 * to 'learning' (re-surfaces it); a new lesson inserts a fresh 'new' card.
 */

import { createServerClient } from '@/lib/supabase'
import { conceptSeeds } from './concept-source'

export interface ConceptSyncResult {
  inserted: number
  updated:  number
  skipped:  number
}

interface ExistingConcept { id: string; atom_slug: string; source_sha: string }

export async function syncConceptCards(userId: string): Promise<ConceptSyncResult> {
  const result: ConceptSyncResult = { inserted: 0, updated: 0, skipped: 0 }
  const sb = createServerClient()
  if (!sb) return result

  const existingResp = await (sb.from('flashcards') as unknown as {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => Promise<{ data: ExistingConcept[] | null; error: unknown }>
      }
    }
  })
    .select('id, atom_slug, source_sha')
    .eq('user_id', userId)
    .eq('kind', 'concept')

  const existing = existingResp.data ?? []
  const byAtom = new Map<string, ExistingConcept>(existing.map((r) => [r.atom_slug, r]))

  const inserts: Array<Record<string, unknown>> = []
  for (const seed of conceptSeeds()) {
    const found = byAtom.get(seed.atomSlug)
    if (!found) {
      inserts.push({
        user_id:           userId,
        kind:              'concept',
        atom_slug:         seed.atomSlug,
        moc_slug:          seed.mocSlug,
        source_sha:        seed.sourceSha,
        front:             seed.front,
        back:              seed.back,
        options:           null,
        reference_context: seed.referenceContext ?? null,
        state:             'new',
        due_at:            new Date().toISOString(),
      })
    } else if (found.source_sha !== seed.sourceSha) {
      const upd = await (sb.from('flashcards') as unknown as {
        update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: unknown }> }
      })
        .update({
          front:             seed.front,
          back:              seed.back,
          reference_context: seed.referenceContext ?? null,
          source_sha:        seed.sourceSha,
          state:             'learning',
          stability:         0,
          difficulty:        5,
          retrievability:    1,
          due_at:            new Date().toISOString(),
          stale_reason:      'concept lesson updated',
        })
        .eq('id', found.id)
      if (!(upd as { error: unknown }).error) result.updated++
    } else {
      result.skipped++
    }
  }

  if (inserts.length > 0) {
    const insResp = await (sb.from('flashcards') as unknown as {
      insert: (rows: unknown[], opts?: { count?: 'exact' }) => Promise<{ error: unknown }>
    }).insert(inserts, { count: 'exact' })
    if (!(insResp as { error: unknown }).error) result.inserted = inserts.length
  }

  return result
}
