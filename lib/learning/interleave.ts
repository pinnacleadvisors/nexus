/**
 * lib/learning/interleave.ts — difficulty-aware interleaving for /learn sessions.
 *
 * Upgrades the old round-robin-by-moc ordering (app/api/learn/session/route.ts)
 * into a scheduler that applies three learning-science principles, all pure +
 * deterministic so it unit-tests without a DB:
 *
 *   1. Track + topic mixing — bucket by (track, moc) where track is
 *      'concept' (platform-internals lessons) vs 'atom' (fact recall), then
 *      round-robin across buckets so a session alternates BOTH topics and the
 *      two learning tracks instead of streaking one.
 *   2. Desirable difficulty — within a bucket, surface the weakest cards first
 *      (lowest FSRS retrievability), so the session leads with what's least
 *      retrievable rather than easy wins.
 *   3. No massed repetition — never place two cards with the same `atom_slug`
 *      (e.g. cloze variants of one fact) back-to-back; spacing beats massing.
 *
 * Generic over any row carrying the four fields below, so the route can pass
 * its `RawCard` shape directly.
 */

export interface InterleaveCard {
  /** Card kind — 'concept' rows form the concept track; everything else atoms. */
  kind:           string
  /** Map-of-Content slug (topic), or null. */
  moc_slug:       string | null
  /** The underlying atom/lesson — variants share this; used for de-massing. */
  atom_slug:      string
  /** FSRS retrievability 0..1 — lower = weaker = surfaced earlier. */
  retrievability: number
}

function trackOf(c: InterleaveCard): 'concept' | 'atom' {
  return c.kind === 'concept' ? 'concept' : 'atom'
}

/**
 * Order a due batch for a session. Pure — same input always yields the same
 * output (no Date/Math.random), so the route stays deterministic + testable.
 */
export function interleaveCards<T extends InterleaveCard>(cards: T[]): T[] {
  if (cards.length <= 1) return cards.slice()

  // 1. Bucket by (track, moc).
  const buckets = new Map<string, T[]>()
  for (const c of cards) {
    const key = `${trackOf(c)}::${c.moc_slug ?? '__none__'}`
    const b = buckets.get(key)
    if (b) b.push(c)
    else buckets.set(key, [c])
  }

  // 2. Weakest-first within each bucket (desirable difficulty). Stable tie-break
  //    keeps the DB's due_at ordering for equal retrievability.
  for (const b of buckets.values()) {
    b.sort((a, z) => a.retrievability - z.retrievability)
  }

  // 3. Round-robin across buckets. Bucket key order is deterministic (insertion
  //    order), so concept/atom buckets interleave with topic buckets.
  const out: T[] = []
  let active = Array.from(buckets.values())
  while (active.length > 0) {
    const next: T[][] = []
    for (const b of active) {
      const head = b.shift()
      if (head) out.push(head)
      if (b.length > 0) next.push(b)
    }
    active = next
  }

  // 4. De-mass: if a card shares an atom_slug with its predecessor, swap it
  //    forward with the next card that differs. Bounded single forward pass.
  for (let i = 1; i < out.length; i++) {
    if (out[i].atom_slug !== out[i - 1].atom_slug) continue
    for (let j = i + 1; j < out.length; j++) {
      if (out[j].atom_slug !== out[i - 1].atom_slug) {
        const tmp = out[i]
        out[i] = out[j]
        out[j] = tmp
        break
      }
    }
  }

  return out
}
