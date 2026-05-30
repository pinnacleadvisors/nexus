/**
 * Unit test for lib/learning/concept-source.ts + the curriculum manifest.
 * Pure, no DB. Run with: `npx --yes tsx __tests__/concept-source.test.ts`
 */
import { conceptSeeds, conceptAtomSlug, CONCEPT_MOC } from '../lib/learning/concept-source'
import { CONCEPT_CURRICULUM } from '../lib/learning/concept-curriculum'

let failures = 0
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`)
  else { console.error(`  ✗ FAIL: ${msg}`); failures++ }
}

const seeds = conceptSeeds()

assert(seeds.length >= 6, `curriculum has >= 6 lessons (got ${seeds.length})`)
assert(seeds.length === CONCEPT_CURRICULUM.length, 'one seed per lesson')
assert(seeds.every(s => s.kind === 'concept'), 'every seed is kind=concept')
assert(seeds.every(s => s.atomSlug.startsWith('concept:')), 'atomSlug is namespaced concept:<slug>')
assert(seeds.every(s => s.mocSlug === CONCEPT_MOC), 'all grouped under the platform-internals MOC')
assert(seeds.every(s => (s.referenceContext ?? '').length > 100), 'each lesson body is substantive (>100 chars)')
assert(seeds.every(s => s.front.startsWith('Explain: ')), 'front is an Explain prompt')
assert(new Set(seeds.map(s => s.atomSlug)).size === seeds.length, 'atom slugs are unique')
assert(new Set(seeds.map(s => s.sourceSha)).size === seeds.length, 'each lesson body hashes distinctly')
assert(conceptAtomSlug('how-an-llm-works') === 'concept:how-an-llm-works', 'conceptAtomSlug round-trips')

// determinism — same input, same shas
{
  const a = conceptSeeds().map(s => s.sourceSha).join(',')
  const b = conceptSeeds().map(s => s.sourceSha).join(',')
  assert(a === b, 'seeds are deterministic (stable shas)')
}

// provider-agnostic spot check — no obvious model-version pins in the bodies
{
  const pins = /\b(gpt-\d|claude-\w+-\d|gemini-\d|qwen\d|llama-?\d|deepseek-\w)\b/i
  const offenders = seeds.filter(s => pins.test(s.referenceContext ?? ''))
  assert(offenders.length === 0, `no model-version pins in lesson bodies (got ${offenders.length})`)
}

if (failures > 0) { console.error(`\n${failures} assertion(s) failed`); process.exit(1) }
console.log('\n✓ concept-source: all assertions passed')
