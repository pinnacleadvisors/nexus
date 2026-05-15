/**
 * lib/chat/crash.ts — crash detection + parsing for chat turns.
 *
 * The claude-gateway returns mid-turn crashes via `result.ok: false` plus
 * an `error` string formatted like:
 *
 *   "claude CLI exited with code 1: <up to 512 chars of stderr>"
 *
 * This module extracts the exit code + stderr tail from that string so
 * the chat UI can render a distinct CrashedTurnCard. Also detects
 * "claimed but unverified" phrases the agent emits before the crash so
 * the operator knows which statements to double-check.
 *
 * Forward-compat: if the gateway is later upgraded to return discrete
 * `exitCode` + `stderrTail` fields, those win; the regex fallback only
 * runs when those fields are absent.
 */

export interface CrashInfo {
  exitCode?:    number
  stderrTail?:  string
  /** The raw error string for display when parsing fails. */
  rawError?:    string
}

const EXIT_CODE_RE = /claude\s+CLI\s+exited\s+with\s+code\s+(-?\d+):\s*([\s\S]*)$/i

/**
 * Parse a gateway error string into structured crash info. When the
 * gateway has been upgraded to provide explicit `exitCode` / `stderrTail`
 * fields, callers should pass those in `hint` so the regex fallback
 * doesn't run.
 */
export function parseCrash(
  errorString: string | undefined,
  hint?: { exitCode?: number | null; stderrTail?: string | null },
): CrashInfo | null {
  if (hint?.exitCode != null || hint?.stderrTail) {
    return {
      exitCode:   hint.exitCode ?? undefined,
      stderrTail: hint.stderrTail ?? undefined,
      rawError:   errorString,
    }
  }
  if (!errorString) return null
  const m = EXIT_CODE_RE.exec(errorString.trim())
  if (m) {
    return {
      exitCode:   Number(m[1]),
      stderrTail: m[2].trim().slice(-512) || undefined,
      rawError:   errorString,
    }
  }
  // Couldn't extract structured info — still surface it as a crash with
  // the raw error so the operator sees SOMETHING actionable.
  return { rawError: errorString }
}

/**
 * Phrases the agent commonly emits to describe future / queued tool
 * calls. When a turn crashes, these are dangerous because the work the
 * agent claimed was queued was actually dropped. Highlight in the UI so
 * the operator double-checks each claim.
 *
 * Case-insensitive whole-word matches on phrases. Word boundaries
 * matter so e.g. "I'll write" doesn't match "I will write the bookend"
 * (which is past-tense if completed).
 */
export const CLAIMED_UNVERIFIED_PATTERNS: RegExp[] = [
  /\bpending\s+in\s+(your|the)\s+harness\b/gi,
  /\bI(?:'|')?ll\s+(?:write|create|open|file|push|commit|update|edit|run|fire)\b/gi,
  /\bI(?:'|')?m\s+(?:now\s+)?(?:writing|creating|opening|filing|pushing|committing|updating|editing|running|firing)\b/gi,
  /\bwrites?\s+(?:are\s+)?queued\b/gi,
  /\bI(?:'|')?ll\s+now\b/gi,
  /\b(?:about\s+to|going\s+to|will\s+now)\s+(?:write|create|open|file|push|commit|update|edit|run|fire)\b/gi,
]

/**
 * Return a list of [start, end] index pairs in `text` matching any of
 * the claimed-unverified patterns. Used by the chat UI to wrap those
 * ranges with an amber highlight when the turn crashed.
 *
 * Returns empty array when `text` is empty or no matches.
 */
export function findClaimedRanges(text: string): Array<[number, number]> {
  if (!text) return []
  const ranges: Array<[number, number]> = []
  for (const re of CLAIMED_UNVERIFIED_PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      ranges.push([m.index, m.index + m[0].length])
      if (m.index === re.lastIndex) re.lastIndex++   // safety against zero-width
    }
  }
  // Merge overlapping/adjacent ranges so the UI doesn't double-wrap.
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) {
      last[1] = Math.max(last[1], r[1])
    } else {
      merged.push([r[0], r[1]])
    }
  }
  return merged
}
