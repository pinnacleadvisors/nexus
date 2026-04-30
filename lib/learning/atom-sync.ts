import { createServerClient } from '@/lib/supabase'
import { cardsForAtom, mcFromMoc, type AtomRow, type MocRow, type CardSeed } from './card-generator'

/**
 * Reconcile derived flashcards against the molecular memory mirror.
 *
 *   - New atom -> insert with state='new', dueAt=now()
 *   - mol_atoms.sha differs from card.source_sha -> reset to learning, log staleReason
 *   - Atom no longer in mol_atoms -> archive (review history kept)
 *
 * The new tables (flashcards, mol_atoms, mol_mocs) are not yet in
 * lib/database.types.ts. Same escape hatch as lib/memory/supabase-reader.ts:
 * cast `from()` to a permissive shape so we don't have to regenerate the
 * full type bundle to ship this PR.
 */

type LooseSelect = {
  select: (s: string, opts?: { count?: 'exact'; head?: boolean }) => LooseSelect
  eq: (k: string, v: unknown) => LooseSelect
  in: (k: string, v: readonly unknown[]) => LooseSelect
  like: (k: string, v: string) => LooseSelect
  insert: (rows: unknown[], opts?: { count?: 'exact' }) => LooseSelect
  update: (patch: unknown) => LooseSelect
  then: <T>(fn: (v: { data: unknown; error: unknown; count?: number | null }) => T) => Promise<T>
}

function loose(sb: ReturnType<typeof createServerClient>): { from: (t: string) => LooseSelect } {
  return sb as unknown as { from: (t: string) => LooseSelect }
}

interface SyncResult {
  inserted: number
  reset: number
  archived: number
  scanned: number
  skipped: number
}

interface ExistingCard {
  id: string
  atom_slug: string
  kind: string
  front: string
  source_sha: string
  state: string
}

export async function syncCardsFromMolecular(userId: string): Promise<SyncResult> {
  const sb = createServerClient()
  const result: SyncResult = { inserted: 0, reset: 0, archived: 0, scanned: 0, skipped: 0 }
  if (!sb) return result

  const db = loose(sb)

  const atomsResp = await db
    .from('mol_atoms')
    .select('slug, title, body_md, sha, frontmatter, scope_id')
  const atoms = (atomsResp as unknown as { data: AtomRow[] | null }).data ?? []
  result.scanned = atoms.length

  const existingResp = await db
    .from('flashcards')
    .select('id, atom_slug, kind, front, source_sha, state')
    .eq('user_id', userId)
  const existing = (existingResp as unknown as { data: ExistingCard[] | null }).data ?? []

  const byKey = new Map<string, ExistingCard>()
  for (const row of existing) {
    byKey.set(`${row.atom_slug}::${row.kind}::${row.front}`, row)
  }

  const liveAtomSlugs = new Set<string>()
  const inserts: Array<Record<string, unknown>> = []
  const resets: Array<{ id: string; staleReason: string }> = []

  for (const atom of atoms) {
    liveAtomSlugs.add(atom.slug)
    for (const seed of cardsForAtom(atom)) {
      const key = `${seed.atomSlug}::${seed.kind}::${seed.front}`
      const found = byKey.get(key)
      if (!found) {
        inserts.push(seedToRow(seed, userId))
      } else if (found.source_sha !== seed.sourceSha) {
        resets.push({
          id: found.id,
          staleReason: `source-sha changed (${found.source_sha.slice(0, 7)} -> ${seed.sourceSha.slice(0, 7)})`,
        })
      } else {
        result.skipped++
      }
    }
  }

  // MOC navigation cards (one per MOC with >=4 atoms).
  const mocsResp = await db
    .from('mol_mocs')
    .select('slug, title, body_md, frontmatter')
  const mocs = (mocsResp as unknown as { data: MocRow[] | null }).data ?? []

  for (const moc of mocs) {
    const own = atoms.filter(a =>
      Array.isArray(a.frontmatter?.links) &&
      (a.frontmatter.links as unknown[]).some(l => typeof l === 'string' && l.includes(moc.slug)),
    )
    if (own.length < 4) continue
    const seed = mcFromMoc(moc, own, atoms)
    if (!seed) continue
    const key = `${seed.atomSlug}::${seed.kind}::${seed.front}`
    if (!byKey.has(key)) inserts.push(seedToRow(seed, userId))
  }

  if (inserts.length > 0) {
    const insResp = await db.from('flashcards').insert(inserts, { count: 'exact' })
    const insErr = (insResp as unknown as { error: unknown }).error
    if (!insErr) result.inserted = inserts.length
  }

  for (const r of resets) {
    const updResp = await db.from('flashcards').update({
      state: 'learning',
      stability: 0,
      difficulty: 5,
      retrievability: 1,
      due_at: new Date().toISOString(),
      stale_reason: r.staleReason,
    }).eq('id', r.id)
    if (!(updResp as unknown as { error: unknown }).error) result.reset++
  }

  const orphanIds = existing
    .filter(row => !liveAtomSlugs.has(row.atom_slug) && row.state !== 'archived')
    .map(row => row.id)
  if (orphanIds.length > 0) {
    const arcResp = await db.from('flashcards').update({ state: 'archived' }).in('id', orphanIds)
    if (!(arcResp as unknown as { error: unknown }).error) result.archived = orphanIds.length
  }

  return result
}

function seedToRow(seed: CardSeed, userId: string): Record<string, unknown> {
  return {
    user_id: userId,
    kind: seed.kind,
    atom_slug: seed.atomSlug,
    moc_slug: seed.mocSlug,
    source_sha: seed.sourceSha,
    front: seed.front,
    back: seed.back,
    options: seed.options ?? null,
    reference_context: seed.referenceContext ?? null,
    state: 'new',
    due_at: new Date().toISOString(),
  }
}
