/**
 * lib/audit/tool-call.ts — append-only tool-call audit helper.
 *
 * Called from every admin MCP wrapper after a tool runs (success OR error)
 * so the operator has a complete history of "agent X called tool Y at time
 * Z with redacted args Q and got result R". Fail-soft: failures to insert
 * an audit row are logged but never thrown — auditing must not break the
 * tool call it's auditing.
 *
 * Secret-redaction rules:
 *   - Any object key matching /^(token|key|secret|password|authorization|api_?key|access_?token|refresh_?token|bearer)$/i
 *     is replaced with "***".
 *   - String values longer than 1KB are truncated to "<first 256 chars>… (truncated)".
 *   - Nested objects/arrays are walked recursively.
 *
 * See: supabase/migrations/058_tool_call_audit.sql
 *      task_plan-platform-expansion.md (Task E2)
 */

import { createServerClient } from '@/lib/supabase'

export type ToolCallStatus = 'ok' | 'error' | 'requires_approval' | 'denied' | 'rate_limited' | 'kill_switch'

export interface RecordToolCallInput {
  agent_slug?:     string | null
  scope?:          string | null
  user_id?:        string | null
  mcp_server:      string
  tool_name:       string
  args?:           unknown
  result_status:   ToolCallStatus
  result?:         unknown
  business_slug?:  string | null
  run_id?:         string | null
  issue_id?:       string | null
  goal_id?:        string | null
  approval_id?:    string | null
  latency_ms?:     number | null
}

const SECRET_KEY_RE = /^(token|key|secret|password|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|bearer|service[_-]?role|encryption[_-]?key|doppler[_-]?token)$/i
const LONG_VALUE_LIMIT = 1024
const TRUNC_KEEP       = 256
const EXCERPT_LIMIT    = 2048

let tableAvailable: boolean | null = null

function isMissingTable(message: string): boolean {
  if (!message) return false
  return /relation .*tool_call_audit.* does not exist|Could not find the table .*tool_call_audit/i.test(message)
}

export function redactArgs(input: unknown): unknown {
  if (input == null) return input
  if (typeof input === 'string') {
    if (input.length > LONG_VALUE_LIMIT) return input.slice(0, TRUNC_KEEP) + '… (truncated)'
    return input
  }
  if (typeof input !== 'object') return input
  if (Array.isArray(input)) return input.map(redactArgs)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) {
      out[k] = '***'
    } else {
      out[k] = redactArgs(v)
    }
  }
  return out
}

function buildExcerpt(result: unknown): string | null {
  if (result == null) return null
  try {
    const s = typeof result === 'string' ? result : JSON.stringify(result)
    if (!s) return null
    return s.length > EXCERPT_LIMIT ? s.slice(0, EXCERPT_LIMIT) + '… (truncated)' : s
  } catch {
    return '(unserialisable result)'
  }
}

export async function recordToolCall(input: RecordToolCallInput): Promise<void> {
  if (tableAvailable === false) return
  const db = createServerClient()
  if (!db) return

  const row = {
    agent_slug:     input.agent_slug   ?? null,
    scope:          input.scope        ?? null,
    user_id:        input.user_id      ?? null,
    mcp_server:     input.mcp_server,
    tool_name:      input.tool_name,
    args_redacted:  input.args !== undefined ? redactArgs(input.args) : null,
    result_status:  input.result_status,
    result_excerpt: buildExcerpt(input.result),
    business_slug:  input.business_slug ?? null,
    run_id:         input.run_id        ?? null,
    issue_id:       input.issue_id      ?? null,
    goal_id:        input.goal_id       ?? null,
    approval_id:    input.approval_id   ?? null,
    latency_ms:     input.latency_ms    ?? null,
  }

  try {
    const res = await ((db.from('tool_call_audit' as never) as unknown as {
      insert: (r: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
    }).insert(row))
    if (res.error) {
      if (isMissingTable(res.error.message)) {
        if (tableAvailable === null) {
          console.warn('[recordToolCall] tool_call_audit table missing — apply migration 058. Audit rows will be silently dropped until then.')
        }
        tableAvailable = false
        return
      }
      console.warn('[recordToolCall] insert failed:', res.error.message)
    } else if (tableAvailable === null) {
      tableAvailable = true
    }
  } catch (err) {
    console.warn('[recordToolCall] threw:', err instanceof Error ? err.message : err)
  }
}

/**
 * Convenience wrapper for the common case: wrap an async tool handler so the
 * audit row records latency + status automatically. Errors propagate to the
 * caller — the audit row is written either way.
 */
export async function withToolCallAudit<T>(
  meta: Omit<RecordToolCallInput, 'result_status' | 'result' | 'latency_ms'>,
  fn:   () => Promise<T>,
): Promise<T> {
  const started = Date.now()
  let status:  ToolCallStatus = 'ok'
  let result:  unknown        = null
  let thrown:  unknown        = null
  try {
    const out = await fn()
    result = out
    return out
  } catch (err) {
    status = 'error'
    thrown = err
    result = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    await recordToolCall({
      ...meta,
      result_status: thrown ? 'error' : status,
      result,
      latency_ms: Date.now() - started,
    }).catch(() => { /* swallow — audit failures never break the tool */ })
  }
}
