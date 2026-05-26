/**
 * @nexus/mcp-permission-broker — Claude-Code-Desktop-style permission UI
 * for the claude-gateway.
 *
 * Claude Code's `--permission-prompt-tool <mcp-tool-name>` flag lets you
 * implement custom permission UI: when the CLI hits a tool call that
 * isn't pre-approved, it invokes the named MCP tool instead of dying
 * with a prose error or waiting on a (missing) TTY. The tool decides.
 *
 * This server exposes exactly one tool: `permission_prompt`. When
 * called:
 *   1. Writes a row to `chat_permission_requests` (Supabase) with
 *      status='pending', stamping the gateway's jobId from env so the
 *      chat poll route can correlate it with the running turn.
 *   2. Polls the same row every ~1s for status change. Operator's
 *      Allow/Deny click against `/api/platform-chat/permission-
 *      requests/:id` updates the row.
 *   3. Returns `{ behavior: 'allow', updatedInput?: ... }` or
 *      `{ behavior: 'deny', message: ... }` once status flips, or
 *      times out as deny after BROKER_TIMEOUT_MS (default 10 min).
 *
 * Required env (gateway-side):
 *   NEXT_PUBLIC_SUPABASE_URL    — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY   — service-role for the table write/read
 *   NEXUS_OPERATOR_USER_ID      — Clerk user_id (or ALLOWED_USER_IDS[0])
 *   NEXUS_JOB_ID                — Gateway jobId, injected per-spawn via
 *                                  claude-gateway/src/spawn.ts. Without
 *                                  it the broker can't correlate to a
 *                                  chat turn and returns a hard deny.
 *
 * Optional env:
 *   BROKER_TIMEOUT_MS           — max wait (default 600_000 = 10 min)
 *   BROKER_POLL_INTERVAL_MS     — poll cadence (default 1000)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const OPERATOR_USER_ID  = process.env.NEXUS_OPERATOR_USER_ID
  ?? (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)[0]
  ?? ''
const JOB_ID            = process.env.NEXUS_JOB_ID ?? ''
const TIMEOUT_MS        = Number(process.env.BROKER_TIMEOUT_MS ?? 600_000)
const POLL_MS           = Number(process.env.BROKER_POLL_INTERVAL_MS ?? 1000)

// Audit sink — `/api/audit/tool-call` on the parent Nexus app. Wired by the
// E3-partial follow-up (task_plan-platform-expansion.md) so every permission
// decision is searchable from the unified /audit page alongside MCP tool calls.
const AUDIT_BASE        = (process.env.NEXUS_AUDIT_BASE_URL ?? '').replace(/\/$/, '')
const AUDIT_TOKEN       = process.env.NEXUS_AUDIT_TOKEN ?? ''
const AGENT_SLUG        = process.env.NEXUS_AGENT_SLUG ?? 'platform-copilot'

async function recordAudit(payload: Record<string, unknown>): Promise<void> {
  if (!AUDIT_BASE) return
  try {
    await fetch(`${AUDIT_BASE}/api/audit/tool-call`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        ...(AUDIT_TOKEN ? { 'X-Audit-Token': AUDIT_TOKEN } : {}),
      },
      body:    JSON.stringify({
        mcp_server: 'permission-broker',
        agent_slug: AGENT_SLUG,
        scope:      'admin',
        user_id:    OPERATOR_USER_ID,
        ...payload,
      }),
      signal:  AbortSignal.timeout(5_000),
    })
  } catch (err) {
    console.warn('[permission-broker] audit POST failed:', err instanceof Error ? err.message : err)
  }
}

function fatal(msg: string): never {
  console.error('[permission-broker] ' + msg)
  process.exit(2)
}

if (!SUPABASE_URL)     fatal('NEXT_PUBLIC_SUPABASE_URL is required')
if (!SUPABASE_KEY)     fatal('SUPABASE_SERVICE_ROLE_KEY is required')
if (!OPERATOR_USER_ID) fatal('NEXUS_OPERATOR_USER_ID or ALLOWED_USER_IDS[0] must be set')
// JOB_ID is checked per-call (fail-soft) so the server starts cleanly
// even when NEXUS_JOB_ID isn't injected — useful for tests.

// ── Supabase REST helpers ────────────────────────────────────────────────────

interface PermissionRow {
  id:          string
  status:      'pending' | 'allowed' | 'denied' | 'expired'
  decision:    { reason?: string; updated_input?: Record<string, unknown> } | null
  tool_input:  Record<string, unknown>
}

async function insertRow(args: {
  toolName:  string
  toolInput: Record<string, unknown>
  toolUseId: string | null
}): Promise<string | null> {
  const url = `${SUPABASE_URL}/rest/v1/chat_permission_requests`
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      apikey:          SUPABASE_KEY,
      Authorization:   `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      Prefer:          'return=representation',
    },
    body: JSON.stringify({
      user_id:     OPERATOR_USER_ID,
      job_id:      JOB_ID,
      tool_name:   args.toolName,
      tool_input:  args.toolInput,
      tool_use_id: args.toolUseId,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    console.error(`[permission-broker] insert failed: ${res.status} ${await res.text().catch(() => '')}`)
    return null
  }
  const rows = (await res.json()) as PermissionRow[]
  return rows[0]?.id ?? null
}

async function fetchRow(id: string): Promise<PermissionRow | null> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/chat_permission_requests`)
  url.searchParams.set('id',      `eq.${id}`)
  url.searchParams.set('user_id', `eq.${OPERATOR_USER_ID}`)
  url.searchParams.set('select',  'id,status,decision,tool_input')
  const res = await fetch(url.toString(), {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept:        'application/json',
    },
    signal: AbortSignal.timeout(5_000),
  })
  if (!res.ok) return null
  const rows = (await res.json()) as PermissionRow[]
  return rows[0] ?? null
}

// ── Tool implementation ──────────────────────────────────────────────────────

/**
 * Decision payload Claude Code expects from a permission-prompt tool.
 * `behavior: 'allow'` proceeds with `updatedInput` (defaults to original
 * tool_input). `behavior: 'deny'` cancels the tool call with `message`
 * surfaced to the model's next reasoning step.
 */
interface PermissionDecision {
  behavior:     'allow' | 'deny'
  updatedInput?: Record<string, unknown>
  message?:     string
}

async function brokerPrompt(args: {
  toolName:  string
  toolInput: Record<string, unknown>
  toolUseId: string | null
}): Promise<PermissionDecision> {
  if (!JOB_ID) {
    return {
      behavior: 'deny',
      message:  'permission-broker: NEXUS_JOB_ID not set in gateway env — cannot correlate this tool call to a chat turn, so it would be invisible to the operator. Fix: spawn.ts must inject NEXUS_JOB_ID per request.',
    }
  }

  // 1. Write the pending row.
  const id = await insertRow(args)
  if (!id) {
    return {
      behavior: 'deny',
      message:  'permission-broker: failed to persist the request to Supabase. Surface this to the operator and stop the action.',
    }
  }

  // 2. Poll for status flip. The decide route updates the row on
  //    operator click; we exit as soon as status moves off 'pending'.
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_MS))
    const row = await fetchRow(id)
    if (!row) continue   // transient — keep polling
    if (row.status === 'pending') continue
    if (row.status === 'allowed') {
      return {
        behavior:     'allow',
        // Operator may have amended the tool input via the card's "edit"
        // affordance. If so, decision.updated_input replaces the
        // original. Otherwise pass the original through unchanged.
        updatedInput: row.decision?.updated_input ?? args.toolInput,
      }
    }
    // denied or expired
    return {
      behavior: 'deny',
      message:  row.decision?.reason
        ?? (row.status === 'expired'
              ? 'permission-broker: operator did not respond before the broker timeout'
              : 'permission-broker: operator denied the tool call'),
    }
  }

  // 3. Local timeout — Supabase update may have failed or operator
  //    walked away. Treat as deny so the agent doesn't proceed silently.
  return {
    behavior: 'deny',
    message:  `permission-broker: timed out after ${TIMEOUT_MS}ms waiting for operator decision. Try a smaller scope or use the chat-level approval-request block protocol instead.`,
  }
}

// ── MCP server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: '@nexus/mcp-permission-broker', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name:        'permission_prompt',
      description: 'Claude Code permission-prompt callback. Writes a pending row to chat_permission_requests, polls for the operator\'s Allow/Deny click, and returns the decision in the format Claude Code\'s --permission-prompt-tool flag expects. NEVER call this directly from agent prose — the CLI invokes it automatically when a tool needs approval.',
      inputSchema: {
        type:       'object',
        properties: {
          tool_name:   { type: 'string', description: 'Tool the CLI is asking permission for (e.g. "Bash", "Edit").' },
          input:       { type: 'object', description: 'Original tool arguments. The operator may amend these.' },
          tool_use_id: { type: 'string', description: 'Stable tool_use id from the CLI event. Optional.' },
        },
        required: ['tool_name', 'input'],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async req => {
  const start = Date.now()
  const args  = (req.params.arguments ?? {}) as Record<string, unknown>
  if (req.params.name !== 'permission_prompt') {
    await recordAudit({ tool_name: req.params.name, args, result_status: 'error', result: { error: 'unknown tool' }, latency_ms: Date.now() - start })
    return { content: [{ type: 'text', text: JSON.stringify({ behavior: 'deny', message: `unknown tool: ${req.params.name}` }) }] }
  }
  const a = args
  const toolName  = typeof a.tool_name   === 'string'                    ? a.tool_name   : ''
  const toolInput = (a.input && typeof a.input === 'object')             ? a.input as Record<string, unknown> : {}
  const toolUseId = typeof a.tool_use_id === 'string'                    ? a.tool_use_id : null
  if (!toolName) {
    await recordAudit({ tool_name: 'permission_prompt', args, result_status: 'error', result: { error: 'missing tool_name' }, latency_ms: Date.now() - start })
    return { content: [{ type: 'text', text: JSON.stringify({ behavior: 'deny', message: 'permission-broker: missing tool_name' }) }] }
  }
  const decision = await brokerPrompt({ toolName, toolInput, toolUseId })
  // Map the Claude Code permission-prompt decision shape onto the audit
  // status enum. 'allow' → ok, 'deny' → denied. tool_call_audit's
  // ToolCallStatus does not have an 'allow' value — 'ok' is the canonical
  // success row.
  const auditStatus = decision.behavior === 'allow' ? 'ok' : 'denied'
  await recordAudit({
    tool_name:     'permission_prompt',
    args:          { tool_name: toolName, tool_use_id: toolUseId, input: toolInput },
    result_status: auditStatus,
    result:        decision,
    latency_ms:    Date.now() - start,
  })
  // Claude Code's --permission-prompt-tool flag expects the decision as
  // a stringified JSON in the tool's `content` (per the SDK docs).
  return { content: [{ type: 'text', text: JSON.stringify(decision) }] }
})

const transport = new StdioServerTransport()
server.connect(transport).then(() => {
  console.error('[permission-broker] ready')
}).catch(err => {
  console.error('[permission-broker] failed to connect transport:', err)
  process.exit(2)
})
