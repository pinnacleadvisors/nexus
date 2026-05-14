/**
 * lib/chat/bug-hunt-finding.ts — `bug-hunt-finding` fenced block parser.
 *
 * Fourth chat-block protocol member. Emitted by the bug-hunt-loop agent
 * during an iteration when it identifies a bug. The chat poll route
 * extracts these and inserts rows into `bug_hunt_findings`, scoped to
 * the session_id specified in the block (with server-side validation
 * that the session belongs to the operator).
 */

export type FindingSeverity = 'p0' | 'p1' | 'p2' | 'p3'
export type FindingCategory = 'static' | 'smoke' | 'semantic'

export interface BugHuntFinding {
  session_id:   string
  iteration:    number
  severity:     FindingSeverity
  category:     FindingCategory
  title:        string
  detail?:      string
  source_path?: string
}

export interface BugHuntFindingParseResult {
  text:     string
  findings: BugHuntFinding[]
}

const FENCED_RE = /```bug-hunt-finding\s*\n([\s\S]*?)```/g

const SEVERITY_VALUES = new Set<FindingSeverity>(['p0', 'p1', 'p2', 'p3'])
const CATEGORY_VALUES = new Set<FindingCategory>(['static', 'smoke', 'semantic'])

interface RawFinding {
  session_id?:  unknown
  iteration?:   unknown
  severity?:    unknown
  category?:    unknown
  title?:       unknown
  detail?:      unknown
  source_path?: unknown
}

function validate(raw: unknown): BugHuntFinding | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as RawFinding
  if (typeof r.session_id !== 'string' || !r.session_id.trim()) return null
  if (typeof r.iteration  !== 'number' || r.iteration < 1)      return null
  if (typeof r.title      !== 'string' || !r.title.trim())      return null
  const severity: FindingSeverity = (typeof r.severity === 'string' && SEVERITY_VALUES.has(r.severity as FindingSeverity))
    ? r.severity as FindingSeverity : 'p2'
  const category: FindingCategory = (typeof r.category === 'string' && CATEGORY_VALUES.has(r.category as FindingCategory))
    ? r.category as FindingCategory : 'semantic'
  const finding: BugHuntFinding = {
    session_id: r.session_id.trim(),
    iteration:  r.iteration,
    severity,
    category,
    title:      r.title.trim().slice(0, 500),
  }
  if (typeof r.detail      === 'string' && r.detail.trim())      finding.detail      = r.detail.trim()
  if (typeof r.source_path === 'string' && r.source_path.trim()) finding.source_path = r.source_path.trim().slice(0, 500)
  return finding
}

export function parseBugHuntFindings(assistantText: string): BugHuntFindingParseResult {
  const findings: BugHuntFinding[] = []
  const cleaned = assistantText.replace(FENCED_RE, (match, jsonRaw: string) => {
    let parsed: unknown
    try { parsed = JSON.parse(jsonRaw) } catch { return match }
    const f = validate(parsed)
    if (!f) return match
    findings.push(f)
    return ''
  })
  return { text: cleaned.replace(/^\s+|\s+$/g, ''), findings }
}
