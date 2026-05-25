/**
 * @nexus/mcp-supabase-admin — MCP server exposing Supabase admin tools to
 * the platform-copilot agent.
 *
 * Read-only tools (pre-approved):
 *   supabase_list_tables()
 *       Lists user tables in the public schema.
 *   supabase_describe_table({ name })
 *       Column names + types for one table.
 *   supabase_select({ sql, params? })
 *       Run a SELECT statement. Statement is regex-checked — anything other
 *       than a single SELECT is rejected before execution.
 *   supabase_recent_log_events({ limit?, route? })
 *       Convenience query against log_events (migration 022) for fast
 *       investigation of Vercel function failures.
 *
 * Mutating tool (gated):
 *   supabase_execute({ sql, params?, confirmed? })
 *       Runs arbitrary SQL via the service role. Returns requires_approval
 *       unless confirmed: true. Operator MUST approve via approval-request
 *       block before re-calling with confirmation.
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL    — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY   — service-role key (bypasses RLS)
 *   NEXUS_AUDIT_BASE_URL?       — POST /api/audit/tool-call (optional; the
 *                                  gateway typically sets this).
 *   NEXUS_AUDIT_TOKEN?          — shared secret for audit endpoint.
 *   NEXUS_AGENT_SLUG?           — defaults to 'platform-copilot'.
 *
 * Implementation note — SQL execution path:
 *   Supabase REST + supabase-js don't expose raw SQL; we use the PostgREST
 *   `rpc` mechanism by registering a `pg_exec(sql text)` helper at deploy
 *   time. For MVP we keep things simple and require that helper to exist;
 *   if it doesn't, supabase_execute returns a clear error directing the
 *   operator to create it (or to fall back to the Supabase dashboard).
 */

import { Server }              from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

const SUPABASE_URL  = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const AUDIT_BASE    = (process.env.NEXUS_AUDIT_BASE_URL ?? '').replace(/\/$/, '')
const AUDIT_TOKEN   = process.env.NEXUS_AUDIT_TOKEN ?? ''
const AGENT_SLUG    = process.env.NEXUS_AGENT_SLUG ?? 'platform-copilot'

function fatal(msg: string): never {
  console.error('[supabase-admin] ' + msg)
  process.exit(2)
}

if (!SUPABASE_URL) fatal('NEXT_PUBLIC_SUPABASE_URL is required')
if (!SUPABASE_KEY) fatal('SUPABASE_SERVICE_ROLE_KEY is required')

async function recordAudit(payload: Record<string, unknown>): Promise<void> {
  if (!AUDIT_BASE) return
  try {
    await fetch(`${AUDIT_BASE}/api/audit/tool-call`, {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        ...(AUDIT_TOKEN ? { 'X-Audit-Token': AUDIT_TOKEN } : {}),
      },
      body:    JSON.stringify({ mcp_server: 'supabase-admin', agent_slug: AGENT_SLUG, scope: 'admin', ...payload }),
      signal:  AbortSignal.timeout(5_000),
    })
  } catch (err) {
    console.warn('[supabase-admin] audit POST failed:', err instanceof Error ? err.message : err)
  }
}

async function supabaseFetch(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const url = `${SUPABASE_URL}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      'apikey':         SUPABASE_KEY,
      'Authorization':  `Bearer ${SUPABASE_KEY}`,
      'Accept':         'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  })
  let body: unknown = null
  try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}

// PostgREST exposes table listing via `OPTIONS /` returning the OpenAPI spec.
async function listTables(): Promise<string[]> {
  const r = await supabaseFetch('/rest/v1/', { headers: { 'Accept': 'application/openapi+json' } })
  if (r.status >= 300 || !r.body || typeof r.body !== 'object') return []
  const spec = r.body as { definitions?: Record<string, unknown>; paths?: Record<string, unknown> }
  if (spec.definitions) return Object.keys(spec.definitions)
  if (spec.paths)       return Object.keys(spec.paths).filter(p => p.startsWith('/')).map(p => p.replace(/^\//, '')).filter(Boolean)
  return []
}

async function describeTable(name: string): Promise<unknown> {
  // PostgREST returns column metadata via the OpenAPI spec keyed by table name.
  const r = await supabaseFetch('/rest/v1/', { headers: { 'Accept': 'application/openapi+json' } })
  if (r.status >= 300 || !r.body || typeof r.body !== 'object') return null
  const spec = r.body as { definitions?: Record<string, unknown> }
  return spec.definitions?.[name] ?? null
}

// SELECT-only enforcement: single statement, starts with SELECT, no semicolons mid-statement.
const SELECT_RE = /^\s*(with\s+.+?\s+)?select\b/is
function isSelectOnly(sql: string): boolean {
  const trimmed = sql.trim().replace(/;\s*$/, '')
  if (!SELECT_RE.test(trimmed)) return false
  if (/;/.test(trimmed))        return false  // multi-statement
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|comment\s+on)\b/i.test(trimmed)) return false
  return true
}

async function rpcExec(sql: string, params?: unknown[]): Promise<{ status: number; body: unknown }> {
  return supabaseFetch('/rest/v1/rpc/pg_exec', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ p_sql: sql, p_params: params ?? [] }),
  })
}

const server = new Server(
  { name: '@nexus/mcp-supabase-admin', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

const TOOLS = [
  { name: 'supabase_list_tables',        description: 'List user tables in the public schema.', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'supabase_describe_table',     description: 'Column metadata for one table.',         inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'supabase_select',             description: 'Run a SELECT statement. Multi-statement, DML, and DDL are rejected — use supabase_execute for those (gated).', inputSchema: { type: 'object', properties: { sql: { type: 'string' }, params: { type: 'array' } }, required: ['sql'] } },
  { name: 'supabase_recent_log_events',  description: 'Convenience: last N log_events rows for fast investigation.', inputSchema: { type: 'object', properties: { limit: { type: 'integer' }, route: { type: 'string' } }, required: [] } },
  { name: 'supabase_execute',            description: 'Execute arbitrary SQL via service role. Returns requires_approval unless confirmed:true. Requires operator approval via approval-request block.', inputSchema: { type: 'object', properties: { sql: { type: 'string' }, params: { type: 'array' }, confirmed: { type: 'boolean' } }, required: ['sql'] } },
]

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

const SelectArgs   = z.object({ sql: z.string(), params: z.array(z.unknown()).optional() })
const ExecuteArgs  = z.object({ sql: z.string(), params: z.array(z.unknown()).optional(), confirmed: z.boolean().optional() })
const DescribeArgs = z.object({ name: z.string() })
const LogArgs      = z.object({ limit: z.number().int().min(1).max(500).optional(), route: z.string().optional() })

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name  = req.params.name
  const args  = (req.params.arguments ?? {}) as Record<string, unknown>
  const start = Date.now()

  async function audit(status: string, result?: unknown) {
    await recordAudit({ tool_name: name, args, result_status: status, result, latency_ms: Date.now() - start })
  }
  function jsonResult(payload: unknown) {
    return { content: [{ type: 'text' as const, text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }] }
  }

  try {
    switch (name) {
      case 'supabase_list_tables': {
        const tables = await listTables()
        await audit('ok', { count: tables.length })
        return jsonResult({ tables })
      }
      case 'supabase_describe_table': {
        const p   = DescribeArgs.parse(args)
        const def = await describeTable(p.name)
        await audit(def ? 'ok' : 'error', { table: p.name, found: !!def })
        return jsonResult({ table: p.name, definition: def })
      }
      case 'supabase_select': {
        const p = SelectArgs.parse(args)
        if (!isSelectOnly(p.sql)) {
          await audit('denied', { reason: 'not-select-only' })
          return jsonResult({ error: 'Only single SELECT statements are allowed here. Use supabase_execute for INSERT/UPDATE/DELETE/DDL (it gates through approval-request).' })
        }
        const r = await rpcExec(p.sql, p.params)
        await audit(r.status < 300 ? 'ok' : 'error', r.body)
        return jsonResult(r.body)
      }
      case 'supabase_recent_log_events': {
        const p     = LogArgs.parse(args)
        const limit = p.limit ?? 50
        const sql   = p.route
          ? `SELECT id, ts, level, route, status, duration_ms, message FROM log_events WHERE route = $1 ORDER BY ts DESC LIMIT ${limit}`
          : `SELECT id, ts, level, route, status, duration_ms, message FROM log_events ORDER BY ts DESC LIMIT ${limit}`
        const r = await rpcExec(sql, p.route ? [p.route] : [])
        await audit(r.status < 300 ? 'ok' : 'error', { row_count: Array.isArray(r.body) ? r.body.length : null })
        return jsonResult(r.body)
      }
      case 'supabase_execute': {
        const p = ExecuteArgs.parse(args)
        if (!p.confirmed) {
          await audit('requires_approval', { tool: 'supabase_execute', sql_preview: p.sql.slice(0, 200) })
          return jsonResult({
            requires_approval: true,
            reason:            'mutating SQL — operator must approve via approval-request block before execution',
            sql_preview:       p.sql.slice(0, 500),
            next_step:         'Emit an approval-request block with the exact SQL, then re-call with confirmed:true after APPROVAL reply.',
          })
        }
        const r = await rpcExec(p.sql, p.params)
        await audit(r.status < 300 ? 'ok' : 'error', r.body)
        return jsonResult(r.body)
      }
      default:
        await audit('error', { error: `unknown_tool ${name}` })
        return jsonResult({ error: `unknown tool: ${name}` })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await audit('error', { error: msg })
    return jsonResult({ error: msg })
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('[supabase-admin] MCP server started.')
