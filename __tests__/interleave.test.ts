/**
 * Unit test for lib/learning/interleave.ts — the difficulty-aware /learn
 * session scheduler. Pure, no DB.
 *
 * Run with: `npx --yes tsx __tests__/interleave.test.ts`
 */
import { interleaveCards, type InterleaveCard } from '../lib/learning/interleave'

let failures = 0
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`)
  else { console.error(`  ✗ FAIL: ${msg}`); failures++ }
}
function card(over: Partial<InterleaveCard> & { atom_slug: string }): InterleaveCard {
  return { kind: 'atom', moc_slug: 'm1', retrievability: 0.5, ...over }
}
function noAdjacentDupe(out: InterleaveCard[]): boolean {
  for (let i = 1; i < out.length; i++) if (out[i].atom_slug === out[i - 1].atom_slug) return false
  return true
}

// 1. Empty / single → unchanged
assert(interleaveCards([]).length === 0, 'empty → empty')
{
  const one = [card({ atom_slug: 'a' })]
  assert(interleaveCards(one).length === 1, 'single card → single card')
}

// 2. Cloze variants of one atom never land back-to-back
{
  const cards = [
    card({ atom_slug: 'fact-x' }),
    card({ atom_slug: 'fact-x' }),
    card({ atom_slug: 'fact-x' }),
    card({ atom_slug: 'fact-y' }),
    card({ atom_slug: 'fact-z' }),
  ]
  const out = interleaveCards(cards)
  assert(out.length === 5, 'no cards dropped')
  assert(noAdjacentDupe(out), 'same atom_slug never adjacent (de-massed)')
}

// 3. Concept + atom tracks mix (not all atoms then all concepts)
{
  const cards = [
    card({ atom_slug: 'a1', kind: 'atom', moc_slug: 'm1' }),
    card({ atom_slug: 'a2', kind: 'atom', moc_slug: 'm1' }),
    card({ atom_slug: 'c1', kind: 'concept', moc_slug: 'internals' }),
    card({ atom_slug: 'c2', kind: 'concept', moc_slug: 'internals' }),
  ]
  const out = interleaveCards(cards)
  const kinds = out.map(c => (c.kind === 'concept' ? 'C' : 'A')).join('')
  // Round-robin across the two track buckets → tracks alternate.
  assert(kinds === 'ACAC' || kinds === 'CACA', `tracks alternate (got ${kinds})`)
}

// 4. Weakest-first within a topic bucket (desirable difficulty)
{
  const cards = [
    card({ atom_slug: 'strong', retrievability: 0.9 }),
    card({ atom_slug: 'weak', retrievability: 0.1 }),
    card({ atom_slug: 'mid', retrievability: 0.5 }),
  ]
  const out = interleaveCards(cards)
  assert(out[0].atom_slug === 'weak', 'weakest card surfaces first')
  assert(out[out.length - 1].atom_slug === 'strong', 'strongest card last')
}

// 5. Topic mixing — two mocs round-robin
{
  const cards = [
    card({ atom_slug: 'p1', moc_slug: 'physics' }),
    card({ atom_slug: 'p2', moc_slug: 'physics' }),
    card({ atom_slug: 'h1', moc_slug: 'history' }),
    card({ atom_slug: 'h2', moc_slug: 'history' }),
  ]
  const out = interleaveCards(cards)
  const mocs = out.map(c => c.moc_slug)
  assert(mocs[0] !== mocs[1], 'adjacent cards span different topics (interleaved)')
}

if (failures > 0) { console.error(`\n${failures} assertion(s) failed`); process.exit(1) }
console.log('\n✓ interleave: all assertions passed')
