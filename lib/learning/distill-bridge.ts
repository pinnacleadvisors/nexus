/**
 * lib/learning/distill-bridge.ts — agent→operator distill pipe (Learning Scope C).
 *
 * When a skill or sub-harness is promoted (draft→verified), seed a `concept`
 * learning card "How <slug> works" so the operator's /learn deck teaches the
 * capabilities their agents just gained. A thin bridge between the verified-
 * artifact gate and the shipped concept-curriculum surface (no new engine).
 *
 * conceptSeedFromVerifiedArtifact is PURE (unit-tested). seedConceptForArtifact
 * persists into `flashcards` mirroring concept-sync's read-branch-insert (no
 * shared upsert helper exists). Fail-soft everywhere — the promote routes call
 * this best-effort and must never block on it.
 */

import { createHash } from 'node:crypto'
import { createServerClient } from '@/lib/supabase'
import { CONCEPT_MOC } from '@/lib/learning/concept-source'
import type { CardSeed } from '@/lib/learning/card-generator'

export interface ArtifactMeta {
  kind:   'skill' | 'sub-harness'
  slug:   string
  name:   string
  intent: string
}

export type DistillResult = 'inserted' | 'updated' | 'skipped' | 'failed'

function sha16(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

/** Pure: build a `concept` CardSeed describing a verified artifact. */
export function conceptSeedFromVerifiedArtifact(meta: ArtifactMeta): CardSeed {
  const kindLabel = meta.kind === 'skill' ? 'skill' : 'sub-harness'
  const name      = meta.name.trim() || meta.slug
  const intent    = meta.intent.trim() || `The ${meta.slug} ${kindLabel}.`
  const title     = `How the ${kindLabel} "${name}" works`
  const body = [
    `**${name}** is a verified ${kindLabel} (\`${meta.kind === 'skill' ? '/' : ''}${meta.slug}\`).`,
    '',
    intent,
    '',
    'Because it is promoted to *verified*, the routing layer can invoke it as a reusable procedure (h5 in the harness taxonomy).',
  ].join('\n')
  return {
    kind:             'concept',
    mocSlug:          CONCEPT_MOC,
    // Namespaced under concept: so the existing concept queries pick it up, but
    // distinct from the hand-authored curriculum slugs.
    atomSlug:         `concept:artifact-${meta.kind}-${meta.slug}`,
    sourceSha:        sha16(body),
    front:            `Explain: ${title}`,
    back:             intent,
    referenceContext: body,
  }
}

/** Parse a skill's name + description from its SKILL.md frontmatter. */
export function artifactMetaFromSkillMd(slug: string, md: string): ArtifactMeta {
  const out: Record<string, string> = {}
  const fm = md.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
  if (fm) {
    for (const line of fm[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/)
      if (kv) out[kv[1]] = kv[2].trim()
    }
  }
  return {
    kind:   'skill',
    slug,
    name:   (out.name || slug).trim(),
    intent: (out.description || `The ${slug} skill.`).trim(),
  }
}

/**
 * Persist (or refresh) the concept card for an artifact. Mirrors concept-sync's
 * read-branch-insert: insert when absent, update on a changed body hash, skip
 * when unchanged. Fail-soft → 'failed' on any DB error / missing table.
 */
export async function seedConceptForArtifact(userId: string, meta: ArtifactMeta): Promise<DistillResult> {
  const seed = conceptSeedFromVerifiedArtifact(meta)
  const sb = createServerClient()
  if (!sb) return 'failed'
  try {
    const ex = await (sb.from('flashcards' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ data: Array<{ id: string; source_sha: string }> | null; error: unknown }> } } }
    })
      .select('id, source_sha').eq('user_id', userId).eq('kind', 'concept').eq('atom_slug', seed.atomSlug)
    const found = ex.data?.[0]

    if (!found) {
      const ins = await (sb.from('flashcards' as never) as unknown as {
        insert: (rows: unknown[]) => Promise<{ error: { message: string } | null }>
      }).insert([{
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
      }])
      return ins.error ? 'failed' : 'inserted'
    }

    if (found.source_sha !== seed.sourceSha) {
      const upd = await (sb.from('flashcards' as never) as unknown as {
        update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> }
      }).update({
        front:             seed.front,
        back:              seed.back,
        reference_context: seed.referenceContext ?? null,
        source_sha:        seed.sourceSha,
      }).eq('id', found.id)
      return upd.error ? 'failed' : 'updated'
    }
    return 'skipped'
  } catch {
    return 'failed'
  }
}
