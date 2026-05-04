/**
 * Exfiltration guard — Mission Control Kit Pack 07 ported to Nexus's
 * cloud-native outbound paths. Scans any string about to leave the platform
 * (Slack post, Notion append, n8n bridge body, email, agent-emitted reply)
 * for patterns matching API keys, OAuth tokens, or high-entropy secrets, and
 * blocks transmission if matched.
 *
 * Default-on. Set `EXFIL_GUARD_ENABLED=false` to disable in development —
 * production refuses to disable so an accidental flag flip can't leak keys.
 *
 * Usage:
 *   import { scanForLeaks, assertExfilSafe } from '@/lib/security/exfil-guard'
 *   const result = scanForLeaks(textAboutToBeSent)
 *   if (!result.safe) { audit({action: 'exfil_blocked', ...}); return }
 *
 *   // Or, fail-closed style:
 *   await assertExfilSafe(text, { surface: 'slack.notify', userId })
 */
import { audit } from '@/lib/audit'
import type { NextRequest } from 'next/server'

export interface ExfilMatch {
  /** Stable identifier for the pattern that fired. */
  type:     string
  /** Redacted preview — never the raw matched value. */
  redacted: string
  /** 0-based byte offset where the match starts in the input string. */
  offset:   number
}

export interface ExfilScanResult {
  safe:    boolean
  matches: ExfilMatch[]
}

// ── Built-in patterns ────────────────────────────────────────────────────────
// Order matters — more specific patterns first so we don't classify a Claude
// key as generic high-entropy hex.
interface PatternSpec {
  type:    string
  re:      RegExp
  /** Human label used in the audit metadata. */
  label:   string
}

const BUILT_IN_PATTERNS: PatternSpec[] = [
  { type: 'anthropic-key',     label: 'Claude API key',           re: /sk-ant-[A-Za-z0-9_-]{40,}/g },
  { type: 'openai-key',        label: 'OpenAI API key',           re: /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { type: 'slack-token',       label: 'Slack token',              re: /xox[bapors]-[0-9]+-[0-9]+-[A-Za-z0-9-]+/g },
  { type: 'github-token',      label: 'GitHub token',             re: /gh[pousr]_[A-Za-z0-9_]{36,}/g },
  { type: 'aws-access-key',    label: 'AWS access key',           re: /AKIA[0-9A-Z]{16}/g },
  { type: 'google-api-key',    label: 'Google API key',           re: /AIza[0-9A-Za-z_-]{35}/g },
  { type: 'stripe-key',        label: 'Stripe key',               re: /(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{24,}/g },
  { type: 'doppler-token',     label: 'Doppler service token',    re: /dp\.(?:pt|st|sa|ct)\.[A-Za-z0-9]{40,}/g },
  { type: 'clerk-secret',      label: 'Clerk secret key',         re: /sk_(?:live|test)_[A-Za-z0-9]{32,}/g },
  { type: 'high-entropy-hex',  label: 'High-entropy hex (40+ chars)', re: /\b[a-fA-F0-9]{40,}\b/g },
]

// User-extension via env. Comma-separated regex literals: e.g.
//   EXFIL_PATTERNS_EXTRA=foo-[a-z]{10,}::custom-foo,bar-\d{6}::custom-bar
function loadExtraPatterns(): PatternSpec[] {
  const raw = process.env.EXFIL_PATTERNS_EXTRA
  if (!raw?.trim()) return []
  return raw.split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map((entry, i) => {
      const [pattern, type] = entry.split('::')
      try {
        return {
          type:  (type ?? `extra-${i}`).trim(),
          label: `Custom pattern: ${(type ?? `extra-${i}`).trim()}`,
          re:    new RegExp(pattern.trim(), 'g'),
        }
      } catch {
        return null
      }
    })
    .filter((p): p is PatternSpec => p !== null)
}

let cachedPatterns: PatternSpec[] | null = null
function patterns(): PatternSpec[] {
  if (cachedPatterns) return cachedPatterns
  cachedPatterns = [...BUILT_IN_PATTERNS, ...loadExtraPatterns()]
  return cachedPatterns
}

// ── Scanner ──────────────────────────────────────────────────────────────────
/** Redact a matched value to a safe, audit-ready preview: 4 leading chars + …. */
function redact(value: string): string {
  if (value.length <= 8) return '****'
  return `${value.slice(0, 4)}…(${value.length} chars)`
}

/** Allow programmatic disable in dev only — production always scans. */
function isEnabled(): boolean {
  if (process.env.EXFIL_GUARD_ENABLED === 'false') {
    if (process.env.NODE_ENV === 'production') return true
    return false
  }
  return true
}

export function scanForLeaks(text: string): ExfilScanResult {
  if (!isEnabled() || !text || text.length === 0) {
    return { safe: true, matches: [] }
  }
  const matches: ExfilMatch[] = []
  for (const spec of patterns()) {
    spec.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = spec.re.exec(text)) !== null) {
      matches.push({
        type:     spec.type,
        redacted: redact(m[0]),
        offset:   m.index,
      })
      if (matches.length >= 20) break
    }
    if (matches.length >= 20) break
  }
  return { safe: matches.length === 0, matches }
}

/**
 * Throws an Error with code `EXFIL_BLOCKED` if the input contains any
 * matched secrets. Audits the block fire-and-forget. Use at every outbound
 * boundary that should refuse to transmit on a leak.
 */
export class ExfilBlockedError extends Error {
  code = 'EXFIL_BLOCKED' as const
  matches: ExfilMatch[]
  surface: string
  constructor(matches: ExfilMatch[], surface: string) {
    super(`exfiltration guard blocked transmission to ${surface} (${matches.length} match${matches.length === 1 ? '' : 'es'})`)
    this.matches = matches
    this.surface = surface
  }
}

export interface AssertOpts {
  /** What outbound surface this transmission was destined for. */
  surface: string
  /** Optional NextRequest, used by audit() for IP capture. */
  req?:    NextRequest
  /** Clerk user_id of the actor whose call is being scanned. */
  userId?: string
  /** Optional resourceId logged with the audit row. */
  resourceId?: string
}

export function assertExfilSafe(text: string, opts: AssertOpts): void {
  const result = scanForLeaks(text)
  if (result.safe) return
  // Fire-and-forget audit — never await a blocking write here.
  if (opts.req) {
    audit(opts.req, {
      action:     'exfil_blocked',
      resource:   opts.surface,
      resourceId: opts.resourceId,
      userId:     opts.userId,
      metadata:   {
        surface: opts.surface,
        matches: result.matches,
        textLen: text.length,
      },
    })
  }
  throw new ExfilBlockedError(result.matches, opts.surface)
}

/** Soft variant: returns true if safe, logs+audits if blocked. Used by
 *  fire-and-forget callers (Inngest steps) that prefer to swallow the throw
 *  but still record the block. */
export function checkExfilSafe(text: string, opts: AssertOpts): boolean {
  try {
    assertExfilSafe(text, opts)
    return true
  } catch (err) {
    if (err instanceof ExfilBlockedError) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[exfil-guard] blocked ${opts.surface}: ${err.matches.length} match(es)`)
      }
      return false
    }
    throw err
  }
}
