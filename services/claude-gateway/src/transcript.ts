/**
 * Pure parsing of Claude Code's on-disk JSONL session transcript.
 *
 * Split out of spawnPty.ts so it can be unit-tested with zero IO / pty / agent
 * imports. The interactive (subscription-billed) path reads the assistant's
 * response from this transcript rather than scraping the TUI — see spawnPty.ts.
 *
 * Event shape mirrors the Anthropic message object the stream-json parser in
 * spawn.ts handles: `assistant` events carry `message.content[]` blocks
 * (text / tool_use), and tool results arrive as `user` events with
 * `tool_result` blocks. We accumulate text, track tool calls, and watch which
 * tool_use ids are still awaiting a result (so "idle" ≠ "mid-tool-run").
 */
import path from 'node:path'
import os from 'node:os'
import type { RunResult, ToolCallRecord } from './spawn.js'

export interface TranscriptState {
  text:           string
  toolCalls:      Map<string, ToolCallRecord>
  pendingToolUse: Set<string>
  usage?:         RunResult['usage']
  model?:         string
  assistantSeen:  boolean
}

export function emptyTranscriptState(): TranscriptState {
  return { text: '', toolCalls: new Map(), pendingToolUse: new Set(), assistantSeen: false }
}

/**
 * Apply ONE JSONL transcript line to the accumulating state. Unknown /
 * non-JSON / partial lines are ignored. Returns true if the line carried turn
 * content (text or a tool event) so the caller can reset its idle timer.
 */
export function applyTranscriptLine(
  rawLine: string,
  state: TranscriptState,
  now: number,
  onDelta?: (d: string) => void,
  onToolEvent?: (r: ToolCallRecord) => void,
): boolean {
  const line = rawLine.trim()
  if (!line) return false
  let event: Record<string, unknown>
  try { event = JSON.parse(line) as Record<string, unknown> } catch { return false }
  const type = event.type as string | undefined

  if (type === 'assistant' && event.message) {
    const message = event.message as {
      content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }>
      usage?: RunResult['usage']
      model?: string
    }
    state.assistantSeen = true
    if (message.usage) state.usage = message.usage
    if (typeof message.model === 'string') state.model = message.model
    let carried = false
    for (const block of message.content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string') {
        state.text += block.text
        carried = true
        if (onDelta) { try { onDelta(block.text) } catch { /* swallow */ } }
      }
      if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        const record: ToolCallRecord = { id: block.id, name: block.name, input: block.input, startedAt: now }
        state.toolCalls.set(block.id, record)
        state.pendingToolUse.add(block.id)
        carried = true
        if (onToolEvent) { try { onToolEvent(record) } catch { /* swallow */ } }
      }
    }
    return carried
  }

  if (type === 'user' && event.message) {
    const message = event.message as {
      content?: Array<{ type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }>
    }
    let carried = false
    for (const block of message.content ?? []) {
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        const rec = state.toolCalls.get(block.tool_use_id)
        if (rec) {
          rec.output = block.content
          rec.isError = block.is_error === true
          rec.finishedAt = now
          if (onToolEvent) { try { onToolEvent(rec) } catch { /* swallow */ } }
        }
        state.pendingToolUse.delete(block.tool_use_id)
        carried = true
      }
    }
    return carried
  }
  return false
}

/**
 * A turn is complete once the assistant emitted ≥1 message, no tool call is
 * still awaiting a result, and the transcript has been idle for `idleMs`. The
 * idle gate distinguishes "finished" from "mid-generation / mid-tool-run".
 */
export function turnComplete(state: TranscriptState, idleMs: number, lastGrowthAt: number, now: number): boolean {
  return state.assistantSeen && state.pendingToolUse.size === 0 && (now - lastGrowthAt) >= idleMs
}

/** Claude Code's transcript path for a given repo cwd + session id. */
export function transcriptPathFor(repoPath: string, sessionId: string, homeDir = os.homedir()): string {
  const slug = repoPath.replace(/[/.]/g, '-')
  return path.join(homeDir, '.claude', 'projects', slug, `${sessionId}.jsonl`)
}
