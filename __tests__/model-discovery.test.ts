/**
 * Unit test for lib/chat/model-discovery.ts — merging Anthropic-API-discovered
 * Claude models into the static chat whitelist so new releases appear without
 * a code edit.
 *
 * Run with: `npx --yes tsx __tests__/model-discovery.test.ts`
 */
import { mergeDiscoveredModels, normalizeClaudeId, labelForClaudeId } from '../lib/chat/model-discovery'
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
