/**
 * POST /api/audit/tool-call
 *
 * Sink endpoint that gateway-side MCP servers (doppler-admin, supabase-admin,
 * any future wrapper) call to persist a tool-invocation audit row. The Nexus
 * app side has direct DB access via lib/audit/tool-call.ts; this route exists
 * so the MCP processes — which run inside the gateway container with no
 * Supabase client of their own — can still write audit rows via simple HTTP.
 *
 * Auth: shared-secret header `X-Audit-Token` (matches NEXUS_AUDIT_TOKEN env).
 * Auth is mandatory — without the token the route 401s, preventing third
 * parties from spamming the audit log.
 *
 * Retry-storm safe: returns 200 + {ok:false,error} so an MCP server's
 * auto-retry on transient DB issues doesn't storm.
 *
 * See: services/mcp-doppler-admin/src/index.ts
 *      services/mcp-supabase-admin/src/index.ts
 *      lib/audit/tool-call.ts
 *      supabase/migrations/058_tool_call_audit.sql
 */

import { NextRequest, NextResponse } from 'next/server'
import { recordToolCall, type ToolCallStatus } from '@/lib/audit/tool-call'

export const runtime = 'nodejs'

const AUDIT_TOKEN = process.env.NEXUS_AUDIT_TOKEN ?? ''

const VALID_STATUSES: ToolCallStatus[] = ['ok', 'error', 'requires_approval', 'denied', 'rate_limited', 'kill_switch']

interface Body {
  agent_slug?:     string | null
  scope?:          string | null
  user_id?:        string | null
  mcp_server?:     string
  tool_name?:      string
  args?:           unknown
  result_status?:  string
  result?:         unknown
  business_slug?:  string | null
  run_id?:         string | null
  issue_id?:       string | null
  goal_id?:        string | null
  approval_id?:    string | null
  latency_ms?:     number | null
}

export async function POST(req: NextRequest) {
  if (!AUDIT_TOKEN) {
    return NextResponse.json({ ok: false, error: 'NEXUS_AUDIT_TOKEN not configured server-side — audit sink disabled' }, { status: 200 })
  }
  const header = req.headers.get('x-audit-token') ?? ''
  if (header !== AUDIT_TOKEN) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: Body
  try { body = await req.json() as Body } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 200 })
  }

  if (typeof body.mcp_server !== 'string' || !body.mcp_server) {
    return NextResponse.json({ ok: false, error: 'mcp_server required' }, { status: 200 })
  }
  if (typeof body.tool_name !== 'string' || !body.tool_name) {
    return NextResponse.json({ ok: false, error: 'tool_name required' }, { status: 200 })
  }

  const rawStatus = body.result_status as ToolCallStatus | undefined
  const status: ToolCallStatus = rawStatus && VALID_STATUSES.includes(rawStatus) ? rawStatus : 'error'

  try {
    await recordToolCall({
      agent_slug:    body.agent_slug    ?? null,
      scope:         body.scope         ?? null,
      user_id:       body.user_id       ?? null,
      mcp_server:    body.mcp_server,
      tool_name:     body.tool_name,
      args:          body.args,
      result_status: status,
      result:        body.result,
      business_slug: body.business_slug ?? null,
      run_id:        body.run_id        ?? null,
      issue_id:      body.issue_id      ?? null,
      goal_id:       body.goal_id       ?? null,
      approval_id:   body.approval_id   ?? null,
      latency_ms:    body.latency_ms    ?? null,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'insert_failed' }, { status: 200 })
  }
}
