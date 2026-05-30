/**
 * Unit test for lib/ai/dispatch.ts — the PURE model-resolution logic
 * (precedence + family mapping). The DB-loading path (resolveEffectiveModel)
 * is integration-tested via the dispatch route; here we cover the pure core.
 *
 * Run with: `npx --yes tsx __tests__/effective-model.test.ts`
 */
import { pickModel, familyForModel } from '../lib/ai/dispatch'

let failures = 0
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`)
  else { console.error(`  ✗ FAIL: ${msg}`); failures++ }
}

// ── pickModel precedence: body > agent > skill > undefined ──────────────────
assert(pickModel({ bodyModel: 'gpt-5.5', agentModel: 'claude-haiku-4-5', skillModel: 'o4' }) === 'gpt-5.5', 'body model wins over agent + skill')
assert(pickModel({ agentModel: 'claude-haiku-4-5', skillModel: 'o4' }) === 'claude-haiku-4-5', 'agent model wins when no body')
assert(pickModel({ skillModel: 'o4' }) === 'o4', 'skill model used when no body/agent')
assert(pickModel({}) === undefined, 'no inputs → undefined (gateway default)')
assert(pickModel({ bodyModel: '   ', agentModel: 'claude-opus-4-7' }) === 'claude-opus-4-7', 'blank body ignored, falls to agent')
assert(pickModel({ bodyModel: '  gpt-5.5  ' }) === 'gpt-5.5', 'model is trimmed')
assert(pickModel({ bodyModel: null, agentModel: null, skillModel: null }) === undefined, 'all null → undefined')

// ── familyForModel: routing family ──────────────────────────────────────────
assert(familyForModel('gpt-5.5') === 'codex', 'gpt-5.5 → codex')
assert(familyForModel('gpt-5-mini') === 'codex', 'gpt-prefixed → codex')
assert(familyForModel('codex-something') === 'codex', 'codex-prefixed → codex')
assert(familyForModel('claude-opus-4-7') === 'anthropic', 'claude catalog id → anthropic')
assert(familyForModel('gemini-2.5-pro') === 'google', 'gemini catalog id → google')
assert(familyForModel('meta/llama-3.3-70b-instruct') === 'nim', 'NIM catalog id → nim')
assert(familyForModel('llama3.3') === 'ollama', 'Ollama catalog id → ollama')
assert(familyForModel('totally-made-up-model') === 'unknown', 'unrecognised id → unknown')
assert(familyForModel(undefined) === 'unknown', 'undefined → unknown')

// ── consistency: a codex-family agent model would route to codex ────────────
{
  const m = pickModel({ agentModel: 'gpt-5.5' })
  assert(m === 'gpt-5.5' && familyForModel(m) === 'codex', 'agent stored gpt model → codex routing')
}

if (failures > 0) { console.error(`\n${failures} assertion(s) failed`); process.exit(1) }
console.log('\n✓ effective-model: all assertions passed')
