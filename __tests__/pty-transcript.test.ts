/**
 * Unit test for services/claude-gateway/src/transcript.ts — the pure parser
 * the SUBSCRIPTION-BILLED pty path uses to read Claude Code's JSONL transcript
 * instead of scraping the interactive TUI. Validates text accumulation, tool
 * call lifecycle, completion detection, and the transcript path slug rule.
 *
 * Run with: `npx --yes tsx __tests__/pty-transcript.test.ts`
 */
import {
  emptyTranscriptState,
  applyTranscriptLine,
  turnComplete,
  transcriptPathFor,
} from '../services/claude-gateway/src/transcript'

let failures = 0
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`)
  else { console.error(`  ✗ FAIL: ${msg}`); failures++ }
}

const A = (content: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content, ...extra } })
const U = (content: unknown[]) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content } })

// ── text accumulation + assistantSeen ───────────────────────────────────────
{
  const s = emptyTranscriptState()
  assert(!s.assistantSeen, 'fresh state has no assistant seen')
  const carried = applyTranscriptLine(A([{ type: 'text', text: 'Hello ' }]), s, 1000)
  assert(carried === true, 'assistant text line carries content')
  applyTranscriptLine(A([{ type: 'text', text: 'world' }], { usage: { output_tokens: 5 }, model: 'claude-opus-4-8' }), s, 1100)
  assert(s.text === 'Hello world', 'text accumulates across assistant events')
  assert(s.assistantSeen === true, 'assistantSeen flips true')
  assert(s.usage?.output_tokens === 5, 'usage captured from message.usage')
  assert(s.model === 'claude-opus-4-8', 'model captured from message.model')
}

// ── tool_use → pending, tool_result → resolved ──────────────────────────────
{
  const s = emptyTranscriptState()
  applyTranscriptLine(A([{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { cmd: 'ls' } }]), s, 2000)
  assert(s.toolCalls.has('tu_1'), 'tool_use recorded in toolCalls')
  assert(s.pendingToolUse.has('tu_1'), 'tool_use marked pending')
  assert(turnComplete(s, 1000, 2000, 9999) === false, 'NOT complete while a tool call is pending')
  applyTranscriptLine(U([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'a.txt', is_error: false }]), s, 2500)
  assert(!s.pendingToolUse.has('tu_1'), 'tool_result clears pending')
  assert(s.toolCalls.get('tu_1')?.output === 'a.txt', 'tool_result output attached')
  assert(s.toolCalls.get('tu_1')?.finishedAt === 2500, 'tool_result finishedAt set')
}

// ── completion gating ───────────────────────────────────────────────────────
{
  const s = emptyTranscriptState()
  assert(turnComplete(s, 1000, 0, 5000) === false, 'NOT complete before any assistant message')
  applyTranscriptLine(A([{ type: 'text', text: 'done' }]), s, 1000)
  assert(turnComplete(s, 4000, 1000, 1100) === false, 'NOT complete until idle threshold elapses')
  assert(turnComplete(s, 4000, 1000, 5200) === true, 'complete once assistant seen + no pending + idle elapsed')
}

// ── callbacks ────────────────────────────────────────────────────────────────
{
  const s = emptyTranscriptState()
  const deltas: string[] = []
  const tools: string[] = []
  applyTranscriptLine(A([{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 't2', name: 'Read' }]), s, 1,
    d => deltas.push(d), r => tools.push(r.name))
  assert(deltas.join('') === 'hi', 'onDelta fired with text block')
  assert(tools[0] === 'Read', 'onToolEvent fired for tool_use')
}

// ── robustness: malformed / non-content lines ───────────────────────────────
{
  const s = emptyTranscriptState()
  assert(applyTranscriptLine('', s, 1) === false, 'empty line ignored')
  assert(applyTranscriptLine('{not json', s, 1) === false, 'partial/non-JSON line ignored')
  assert(applyTranscriptLine(JSON.stringify({ type: 'queue-operation' }), s, 1) === false, 'unrelated event ignored')
  assert(s.text === '' && !s.assistantSeen, 'state untouched by ignored lines')
}

// ── transcript path slug rule (matches ~/.claude/projects/<slug>) ───────────
{
  const p = transcriptPathFor('/repo', 'abc-123', '/root')
  assert(p === '/root/.claude/projects/-repo/abc-123.jsonl', `slug for /repo → ${p}`)
  const w = transcriptPathFor('/Users/u/dev/nexus/.claude/worktrees/x', 'sid', '/home/u')
  assert(w.includes('-Users-u-dev-nexus--claude-worktrees-x/sid.jsonl'), `worktree slug ok → ${w}`)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
