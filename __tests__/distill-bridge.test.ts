/**
 * Unit test for lib/learning/distill-bridge.ts (Learning Scope C).
 * Pure, no DB. Run with: `npx --yes tsx __tests__/distill-bridge.test.ts`
 */
import { conceptSeedFromVerifiedArtifact, artifactMetaFromSkillMd } from '../lib/learning/distill-bridge'
import { CONCEPT_MOC } from '../lib/learning/concept-source'

let failures = 0
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`)
  else { console.error(`  ✗ FAIL: ${msg}`); failures++ }
}

// ── conceptSeedFromVerifiedArtifact — skill ──────────────────────────────────
const skillSeed = conceptSeedFromVerifiedArtifact({
  kind: 'skill', slug: 'compute-mrr', name: 'Compute MRR',
  intent: 'Compute monthly recurring revenue from a Stripe export.',
})
assert(skillSeed.kind === 'concept', 'seed is kind=concept')
assert(skillSeed.atomSlug === 'concept:artifact-skill-compute-mrr', 'skill atomSlug is namespaced')
assert(skillSeed.mocSlug === CONCEPT_MOC, 'grouped under the platform-internals MOC')
assert(skillSeed.front.startsWith('Explain: '), 'front is an Explain prompt')
assert(skillSeed.front.includes('Compute MRR'), 'front names the artifact')
assert((skillSeed.referenceContext ?? '').includes('Compute monthly recurring revenue'), 'body carries the intent')
assert(skillSeed.sourceSha.length === 16, 'source sha is 16 chars')

// ── conceptSeedFromVerifiedArtifact — sub-harness ────────────────────────────
const harnessSeed = conceptSeedFromVerifiedArtifact({
  kind: 'sub-harness', slug: 'launch-storefront', name: 'launch-storefront',
  intent: 'Build v1 of the storefront.',
})
assert(harnessSeed.atomSlug === 'concept:artifact-sub-harness-launch-storefront', 'sub-harness atomSlug is namespaced')
assert(harnessSeed.front.includes('sub-harness'), 'front labels it a sub-harness')

// ── determinism + distinctness ───────────────────────────────────────────────
{
  const a = conceptSeedFromVerifiedArtifact({ kind: 'skill', slug: 's', name: 'S', intent: 'x' }).sourceSha
  const b = conceptSeedFromVerifiedArtifact({ kind: 'skill', slug: 's', name: 'S', intent: 'x' }).sourceSha
  assert(a === b, 'same artifact → deterministic sha')
  const c = conceptSeedFromVerifiedArtifact({ kind: 'skill', slug: 's', name: 'S', intent: 'y' }).sourceSha
  assert(a !== c, 'changed intent → distinct sha (drives the refresh path)')
}

// ── empty intent falls back gracefully ───────────────────────────────────────
{
  const seed = conceptSeedFromVerifiedArtifact({ kind: 'skill', slug: 'bare', name: '', intent: '' })
  assert(seed.atomSlug === 'concept:artifact-skill-bare', 'empty name still produces a valid seed')
  assert((seed.back ?? '').includes('bare'), 'fallback back mentions the slug')
}

// ── artifactMetaFromSkillMd — frontmatter parse ──────────────────────────────
{
  const md = '---\nname: Firecrawl Local\ndescription: Scrape a URL to markdown.\nstatus: verified\n---\n\nbody…'
  const meta = artifactMetaFromSkillMd('firecrawl_local', md)
  assert(meta.kind === 'skill', 'kind is skill')
  assert(meta.name === 'Firecrawl Local', 'parses name')
  assert(meta.intent === 'Scrape a URL to markdown.', 'parses description as intent')
}
{
  const meta = artifactMetaFromSkillMd('bare', 'no frontmatter here')
  assert(meta.name === 'bare', 'no frontmatter → name falls back to slug')
  assert(meta.intent.includes('bare'), 'no frontmatter → intent mentions slug')
}

if (failures > 0) { console.error(`\n${failures} assertion(s) failed`); process.exit(1) }
console.log('\n✓ distill-bridge: all assertions passed')
