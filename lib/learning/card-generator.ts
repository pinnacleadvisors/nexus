import type { CardKind, Flashcard } from '@/lib/types'
import { MAX_CARDS_PER_ATOM, MIN_BODY_FOR_CLOZE } from './types'

/**
 * Atom -> card transformations. The cron calls these to materialise flashcards
 * from `mol_atoms` + `mol_mocs` rows. Pure functions: no I/O. The caller
 * persists the returned partials (an `id`, `userId`, and timestamps are added
 * at insert time).
 */

export type CardSeed = Omit<
  Flashcard,
  | 'id'
  | 'userId'
  | 'state'
  | 'stability'
  | 'difficulty'
  | 'retrievability'
  | 'dueAt'
  | 'crown'
  | 'streakCount'
  | 'lastReviewedAt'
  | 'createdAt'
  | 'updatedAt'
>

interface AtomRow {
  slug: string
  title: string
  body_md: string
  sha: string
  frontmatter: Record<string, unknown>
}

interface MocRow {
  slug: string
  title: string
  body_md: string
  frontmatter: Record<string, unknown>
}

/** Strip the markdown fence (`# Title`) and `## Related` section, return the core fact. */
function coreFact(body: string): string {
  return body
    .replace(/^#\s+.*$/m, '')         // drop the H1 title
    .split(/^##\s+/m)[0]!              // keep only the first section
    .trim()
}

/** Find the first MOC slug listed in the atom's frontmatter `links` array. */
function pickMoc(atom: AtomRow): string | null {
  const links = atom.frontmatter.links
  if (!Array.isArray(links)) return null
  for (const raw of links) {
    if (typeof raw !== 'string') continue
    const m = /^\[\[([^\]]+)\]\]$/.exec(raw.trim())
    if (m && m[1]) return m[1]
  }
  return null
}

/** Build a flip Q&A from the atom title + body. Always succeeds. */
export function flipFromAtom(atom: AtomRow): CardSeed {
  return {
    kind: 'flip',
    mocSlug: pickMoc(atom),
    atomSlug: atom.slug,
    sourceSha: atom.sha,
    front: atom.title,
    back: coreFact(atom.body_md),
  }
}

/** Build a Feynman card — same content as flip, different `kind`. */
export function feynmanFromAtom(atom: AtomRow): CardSeed {
  const fact = coreFact(atom.body_md)
  return {
    kind: 'feynman',
    mocSlug: pickMoc(atom),
    atomSlug: atom.slug,
    sourceSha: atom.sha,
    front: `Explain: ${atom.title}`,
    back: fact,
    referenceContext: fact,
  }
}

/**
 * Heuristic cloze blank picker. Selects up to `maxBlanks` candidate spans:
 *   - Quoted strings (high signal, "API patterns")
 *   - Capitalised multi-word proper nouns
 *   - Numbers with units (5000/h, 90 days, 1024 bytes)
 *   - Backticked identifiers
 *
 * Returns one card per blank. Skips atoms whose body is too short to support
 * meaningful cloze deletion. The cron may layer a Claude pass on top of this
 * to filter low-quality picks; this heuristic guarantees the cron makes
 * progress even if the Claude call fails.
 */
export function clozeFromAtom(atom: AtomRow, maxBlanks = 2): CardSeed[] {
  const fact = coreFact(atom.body_md)
  if (fact.length < MIN_BODY_FOR_CLOZE) return []

  const candidates = new Set<string>()
  // Backticks (identifiers, file paths, env vars).
  for (const m of fact.matchAll(/`([^`]{2,40})`/g)) candidates.add(m[1]!)
  // Numbers with units.
  for (const m of fact.matchAll(/\b(\d+(?:[.,]\d+)?\s?(?:%|ms|s|min|h|days?|MB|KB|GB|tokens?|chars?))/g)) {
    candidates.add(m[1]!)
  }
  // Capitalised multi-word names (up to 3 words).
  for (const m of fact.matchAll(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,2})\b/g)) {
    candidates.add(m[1]!)
  }

  const picks = Array.from(candidates).slice(0, maxBlanks)
  return picks.map((answer, i) => ({
    kind: 'cloze' as CardKind,
    mocSlug: pickMoc(atom),
    atomSlug: atom.slug,
    sourceSha: atom.sha,
    // Replace only the first occurrence to keep the cloze tight.
    front: fact.replace(answer, `{{c${i + 1}::____}}`),
    back: answer,
    referenceContext: fact,
  }))
}

/**
 * MOC navigation card: "Which atom belongs to this concept?". Pulls 4 atom
 * titles from the same MOC; one is correct, three are random distractors
 * from sibling atoms across the user's whole deck.
 */
export function mcFromMoc(
  moc: MocRow,
  ownAtoms: AtomRow[],
  distractorPool: AtomRow[],
): CardSeed | null {
  if (ownAtoms.length === 0) return null
  const correct = ownAtoms[0]!
  const distractors = pickDistractors(distractorPool, correct.slug, 3)
  if (distractors.length < 3) return null

  const options = shuffle([correct.title, ...distractors.map(d => d.title)])
  return {
    kind: 'multiple-choice',
    mocSlug: moc.slug,
    atomSlug: correct.slug,
    sourceSha: correct.sha,
    front: `Which fact belongs to "${moc.title}"?`,
    back: correct.title,
    options,
  }
}

function pickDistractors(pool: AtomRow[], excludeSlug: string, n: number): AtomRow[] {
  const filtered = pool.filter(a => a.slug !== excludeSlug)
  return shuffle(filtered).slice(0, n)
}

function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/**
 * Generate the full card deck for a single atom: flip + Feynman + up to
 * (MAX_CARDS_PER_ATOM - 2) cloze cards.
 */
export function cardsForAtom(atom: AtomRow): CardSeed[] {
  const seeds: CardSeed[] = [flipFromAtom(atom), feynmanFromAtom(atom)]
  const remaining = MAX_CARDS_PER_ATOM - seeds.length
  if (remaining > 0) {
    seeds.push(...clozeFromAtom(atom, remaining))
  }
  return seeds
}

export type { AtomRow, MocRow }
