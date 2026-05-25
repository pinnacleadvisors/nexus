/**
 * @nexus/mcp-doppler-admin — MCP server exposing Doppler tools to the
 * platform-copilot agent.
 *
 * Three read-only tools fire freely (pre-approved):
 *   doppler_list_projects()
 *   doppler_list_configs({ project })
 *   doppler_list_secret_names({ project, config })
 *
 * One sensitive-read tool fires freely but is audited as 'sensitive':
 *   doppler_get_secret({ project, config, name })   — returns the value, redacted in audit row
 *
 * Three mutating tools return `requires_approval` instead of executing —
 * the agent MUST escalate via an `approval-request` block before the
 * operator manually re-invokes with `confirmed: true`:
 *   doppler_set_secret({ project, config, name, value, confirmed? })
 *   doppler_delete_secret({ project, config, name, confirmed? })
 *   doppler_rotate_service_token({ project, config, confirmed? })
 *
 * Required env:
 *   DOPPLER_TOKEN              — service token with read access (write tools
 *                                additionally require the token to have write
 *                                scope; Doppler rejects with 403 if not).
 *   NEXUS_AUDIT_BASE_URL?      — POST /api/audit/tool-call (optional; the
 *                                gateway typically sets this to the parent
 *                                Nexus app URL). When unset, audit calls
 *                                are silently dropped (logged once).
 *   NEXUS_AUDIT_TOKEN?         — shared secret for the audit endpoint.
 *   NEXUS_AGENT_SLUG?          — stamped on every audit row; defaults to
 *                                'platform-copilot' since this MCP is wired
 *                                onto the claude-gateway.
 */

import { Server }              from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

const DOPPLER_TOKEN      = process.env.DOPPLER_TOKEN ?? ''
const DOPPLER_BASE       = (process.env.DOPPLER_API_URL ?? 'https://api.doppler.com').replace(/\/$/, '')
const AUDIT_BASE         = (process.env.NEXUS_AUDIT_BASE_URL ?? '').replace(/\/$/, '')
const AUDIT_TOKEN        = process.env.NEXUS_AUDIT_TOKEN ?? ''
const AGENT_SLUG         = process.env.NEXUS_AGENT_SLUG ?? 'platform-copilot'

function fatal(msg: string): never {
  console.error('[doppler-admin] ' + msg)
  process.exit(2)
}

if (!DOPPLER_TOKEN) fatal('DOPPLER_TOKEN is required')

async function dopplerFetch(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const url = `${DOPPLER_BASE}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      'Authorization': `Bearer ${DOPPLER_TOKEN}`,
      'Accept':        'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  })
  let body: unknown = null
  try { body = await res.json() } catch { /* empty body */ }
  return { status: res.status, body }
}

async function recordAudit(payload: Record<string, unknown>): Promise<void> {
  if (!AUDIT_BASE) return
  try {
    await fetch(`${AUDIT_BASE}/api/audit/tool-call`, {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        ...(AUDIT_TOKEN ? { 'X-Audit-Token': AUDIT_TOKEN } : {}),
      },
      body:    JSON.stringify({ mcp_server: 'doppler-admin', agent_slug: AGENT_SLUG, scope: 'admin', ...payload }),
      signal:  AbortSignal.timeout(5_000),
    })
  } catch (err) {
    console.warn('[doppler-admin] audit POST failed:', err instanceof Error ? err.message : err)
  }
}

const server = new Server(
  { name: '@nexus/mcp-doppler-admin', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

const TOOLS = [
  { name: 'doppler_list_projects', description: 'List all Doppler projects the token can access.', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'doppler_list_configs',  description: 'List configs (envs) for a project.', inputSchema: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] } },
  { name: 'doppler_list_secret_names', description: 'List secret NAMES (no values) for a config.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, config: { type: 'string' } }, required: ['project', 'config'] } },
  { name: 'doppler_get_secret',    description: 'Read one secret VALUE. Audited as sensitive — value redacted in audit row, returned only to the agent.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, config: { type: 'string' }, name: { type: 'string' } }, required: ['project', 'config', 'name'] } },
  { name: 'doppler_set_secret',    description: 'Write/overwrite a secret value. Requires approval-request flow.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, config: { type: 'string' }, name: { type: 'string' }, value: { type: 'string' }, confirmed: { type: 'boolean' } }, required: ['project', 'config', 'name', 'value'] } },
  { name: 'doppler_delete_secret', description: 'Delete a secret. Requires approval-request flow.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, config: { type: 'string' }, name: { type: 'string' }, confirmed: { type: 'boolean' } }, required: ['project', 'config', 'name'] } },
  { name: 'doppler_rotate_service_token', description: 'Rotate the active service token. DESTRUCTIVE — old token immediately revoked. Requires approval-request flow.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, config: { type: 'string' }, confirmed: { type: 'boolean' } }, required: ['project', 'config'] } },
]

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

const SetSecretArgs    = z.object({ project: z.string(), config: z.string(), name: z.string(), value: z.string(), confirmed: z.boolean().optional() })
const DeleteSecretArgs = z.object({ project: z.string(), config: z.string(), name: z.string(), confirmed: z.boolean().optional() })
const RotateArgs       = z.object({ project: z.string(), config: z.string(), confirmed: z.boolean().optional() })
const ListConfigsArgs  = z.object({ project: z.string() })
const ListSecretsArgs  = z.object({ project: z.string(), config: z.string() })
const GetSecretArgs    = z.object({ project: z.string(), config: z.string(), name: z.string() })

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
      case 'doppler_list_projects': {
        const r = await dopplerFetch('/v3/projects')
        await audit(r.status >= 200 && r.status < 300 ? 'ok' : 'error', r.body)
        return jsonResult(r.body)
      }
      case 'doppler_list_configs': {
        const p = ListConfigsArgs.parse(args)
        const r = await dopplerFetch(`/v3/configs?project=${encodeURIComponent(p.project)}`)
        await audit(r.status >= 200 && r.status < 300 ? 'ok' : 'error', r.body)
        return jsonResult(r.body)
      }
      case 'doppler_list_secret_names': {
        const p = ListSecretsArgs.parse(args)
        const r = await dopplerFetch(`/v3/configs/config/secrets/names?project=${encodeURIComponent(p.project)}&config=${encodeURIComponent(p.config)}`)
        await audit(r.status >= 200 && r.status < 300 ? 'ok' : 'error', r.body)
        return jsonResult(r.body)
      }
      case 'doppler_get_secret': {
        const p = GetSecretArgs.parse(args)
        const r = await dopplerFetch(`/v3/configs/config/secret?project=${encodeURIComponent(p.project)}&config=${encodeURIComponent(p.config)}&name=${encodeURIComponent(p.name)}`)
        // Audit excerpt is intentionally a fingerprint (NOT the value) — lib/audit/tool-call.ts also redacts but defense-in-depth here.
        await audit(r.status >= 200 && r.status < 300 ? 'ok' : 'error', { ok: r.status < 300, secret_name: p.name, value_present: !!(r.body as { value?: { raw?: string } })?.value?.raw })
        return jsonResult(r.body)
      }
      case 'doppler_set_secret': {
        const p = SetSecretArgs.parse(args)
        if (!p.confirmed) {
          await audit('requires_approval', { tool: 'doppler_set_secret', name: p.name, project: p.project, config: p.config })
          return jsonResult({ requires_approval: true, reason: 'mutating call — operator must approve via approval-request block', next_step: 'Emit an approval-request block including this exact set, then re-call with confirmed:true after APPROVAL reply.' })
        }
        const r = await dopplerFetch('/v3/configs/config/secrets', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ project: p.project, config: p.config, secrets: { [p.name]: p.value } }),
        })
        await audit(r.status >= 200 && r.status < 300 ? 'ok' : 'error', r.body)
        return jsonResult(r.body)
      }
      case 'doppler_delete_secret': {
        const p = DeleteSecretArgs.parse(args)
        if (!p.confirmed) {
          await audit('requires_approval', { tool: 'doppler_delete_secret', name: p.name, project: p.project, config: p.config })
          return jsonResult({ requires_approval: true, reason: 'destructive — operator must approve', next_step: 'Emit approval-request then re-call with confirmed:true.' })
        }
        const r = await dopplerFetch('/v3/configs/config/secrets', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ project: p.project, config: p.config, secrets: { [p.name]: null } }),
        })
        await audit(r.status >= 200 && r.status < 300 ? 'ok' : 'error', r.body)
        return jsonResult(r.body)
      }
      case 'doppler_rotate_service_token': {
        const p = RotateArgs.parse(args)
        if (!p.confirmed) {
          await audit('requires_approval', { tool: 'doppler_rotate_service_token', project: p.project, config: p.config })
          return jsonResult({ requires_approval: true, reason: 'destructive — old token immediately revoked', next_step: 'Emit approval-request, then re-call with confirmed:true.' })
        }
        // Doppler doesn't have a direct "rotate" — the convention is "create new token, revoke old". We surface this as a manual-task for now.
        await audit('requires_approval', { reason: 'Doppler has no atomic rotate endpoint — operator must rotate manually via dashboard.' })
        return jsonResult({ requires_approval: true, manual_steps: 'Doppler dashboard → Service tokens → Generate new → revoke old. The MCP cannot do this atomically; surface as a manual-task block.' })
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
console.error('[doppler-admin] MCP server started.')
