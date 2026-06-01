/**
 * Unit test for lib/chat/model-discovery.ts — merging Anthropic-API-discovered
 * Claude models into the static chat whitelist so new releases appear without
 * a code edit.
 *
 * Run with: `npx --yes tsx __tests__/model-discovery.test.ts`
 */
import { mergeDiscoveredModels, normalizeClaudeId, labelForClaudeId, parseClaudeVersion } from '../lib/chat/model-discovery'
import { AVAILABLE_MODELS } from '../lib/chat/models'

let failures = 0
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`)
  else { console.error(`  ✗ FAIL: ${msg}`); failures++ }
}

// ── helpers ──────────────────────────────────────────────────────────────────
assert(normalizeClaudeId('claude-opus-4-9-20260601') === 'claude-opus-4-9', 'date suffix stripped')
assert(normalizeClaudeId('claude-opus-4-8') === 'claude-opus-4-8', 'short id unchanged')
assert(labelForClaudeId('claude-opus-4-9-20260601') === 'Opus 4.9', 'label derived from dated id')
assert(labelForClaudeId('claude-sonnet-4-7') === 'Sonnet 4.7', 'label derived for sonnet')

// ── merge: no discovery → static unchanged ───────────────────────────────────
{
  const merged = mergeDiscoveredModels(AVAILABLE_MODELS, [])
  assert(merged.length === AVAILABLE_MODELS.length, 'empty discovery → static list unchanged')
  assert(merged[0].id === AVAILABLE_MODELS[0].id, 'default (first entry) preserved')
}

// ── version parsing (the gate that rejects outdated/unusable ids) ────────────
assert(parseClaudeVersion('claude-sonnet-4') === null, 'claude-sonnet-4 (no minor) does NOT parse → cannot be added')
assert(parseClaudeVersion('claude-3-5-sonnet-20241022') === null, 'claude-3-5-sonnet (wrong shape) does NOT parse')
{ const v = parseClaudeVersion('claude-opus-4-8-20260601'); assert(!!v && v.family === 'opus' && v.major === 4 && v.minor === 8, 'dated claude-opus-4-8-… parses to opus 4.8') }

// ── merge: OUTDATED / unusable models are REJECTED (the claude-sonnet-4 crash) ─
{
  // These are exactly the kind of ids the Anthropic /v1/models API returned for
  // a real key — including the one that crashed the turn ("claude-sonnet-4").
  const merged = mergeDiscoveredModels(AVAILABLE_MODELS, [
    'claude-sonnet-4',                 // the crash — no minor, unusable
    'claude-sonnet-4-5-20250929',      // 4.5 < baseline 4.6 → outdated
    'claude-opus-4-7',                 // older than baseline 4.8
    'claude-3-5-sonnet-20241022',      // legacy family/shape
    'claude-opus-4-1-20250805',        // way older
  ])
  assert(merged.length === AVAILABLE_MODELS.length, 'NONE of the outdated/legacy ids are added')
  assert(!merged.some(m => m.id === 'claude-sonnet-4'), 'claude-sonnet-4 (the crashing model) is NOT in the dropdown')
  assert(!merged.some(m => m.id.startsWith('claude-sonnet-4-5')), 'older sonnet-4-5 is NOT in the dropdown')
}

// ── merge: dedupes already-known + dated variants ────────────────────────────
{
  const merged = mergeDiscoveredModels(AVAILABLE_MODELS, ['claude-opus-4-8', 'claude-opus-4-8-20260601', 'claude-sonnet-4-6'])
  assert(merged.length === AVAILABLE_MODELS.length, 'all-known discovery (incl dated variant) adds nothing')
}

// ── merge: a genuinely new model is appended after the claude block ──────────
{
  const merged = mergeDiscoveredModels(AVAILABLE_MODELS, ['claude-opus-4-9-20260601', 'gpt-9'])
  const ids = merged.map(m => m.id)
  assert(ids.includes('claude-opus-4-9'), 'new opus-4-9 added (date-normalized)')
  assert(!ids.includes('gpt-9'), 'non-claude id ignored (chat can only dispatch the anthropic family here)')
  // appended after the last claude entry, before codex-direct
  const newIdx = ids.indexOf('claude-opus-4-9')
  const codexIdx = ids.indexOf('codex-direct')
  assert(codexIdx === -1 || newIdx < codexIdx, 'new model placed before codex-direct')
  const added = merged.find(m => m.id === 'claude-opus-4-9')
  assert(added?.label === 'Opus 4.9' && added?.provider === 'claude', 'added entry has derived label + claude provider')
  assert(merged[0].id === AVAILABLE_MODELS[0].id, 'default still the pinned static first entry (not auto-changed)')
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
