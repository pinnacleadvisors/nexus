/**
 * @nexus/mcp-composio-admin — Hard-isolation MCP wrapper around Composio,
 * scoped to Admin-scope connected accounts (PR #151).
 *
 * Why this exists
 * ───────────────
 * The vanilla `@composio/rube-mcp` exposes EVERY Composio connection the
 * configured API key can see — Admin + Shared + per-business. The platform-
 * copilot agent is supposed to use Admin-scope only, but rube-mcp gives it
 * no way to filter, relying on agent self-discipline (the soft-isolation
 * pattern shipped in PR #152). That's enough for a single-user owner-only
 * setup, but fragile.
 *
 * This wrapper makes the isolation *structural*. At startup it queries
 * Supabase for the operator's admin-scope `connected_accounts` rows. The
 * MCP tools it exposes can ONLY route to those accounts. There is no API
 * surface to invoke a non-admin `composio_account_id` — the agent literally
 * cannot reach Shared or per-business tokens through this server.
 *
 * Tools exposed (3 total)
 * ───────────────────────
 *   admin_list_connected_platforms()
 *       Returns the list of platforms connected in Admin scope. Use this
 *       BEFORE composing a tool call to know what's available.
 *
 *   admin_list_actions(platform: string)
 *       Returns the Composio action slugs available for that platform.
 *       Forwards to Composio's tools-list API.
 *
 *   admin_execute_action(platform: string, action: string, args?: object)
 *       Executes the named Composio action against the admin-scope
 *       connected_account_id for that platform. Validates the platform is
 *       in admin scope before sending. Returns the Composio response body.
 *
 * Required env
 * ────────────
 *   COMPOSIO_API_KEY            — talk to Composio's REST API
 *   NEXT_PUBLIC_SUPABASE_URL    — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY   — service-role key for the connected_accounts
 *                                  query (RLS-bypassing read)
 *   NEXUS_OPERATOR_USER_ID      — Clerk user_id whose admin scope to load.
 *                                  Defaults to the first ALLOWED_USER_IDS entry
 *                                  when unset (single-user-mode convenience).
 *
 * Reload-on-change
 * ────────────────
 * The admin-scope account list is loaded once at startup. If the operator
 * connects a new platform in /settings/accounts → Admin, they need to
 * trigger a gateway restart (Coolify → Redeploy) for the MCP server to
 * pick it up. A future enhancement could refresh the list periodically or
 * on demand via a tool, but for MVP we keep it boot-time only.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const COMPOSIO_API_KEY  = process.env.COMPOSIO_API_KEY  ?? ''
const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const COMPOSIO_BASE     = (process.env.COMPOSIO_API_URL ?? 'https://backend.composio.dev').replace(/\/$/, '')
const OPERATOR_USER_ID  = process.env.NEXUS_OPERATOR_USER_ID
  ?? (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)[0]
  ?? ''

function fatal(msg: string): never {
  console.error('[composio-admin] ' + msg)
  process.exit(2)
}

if (!COMPOSIO_API_KEY) fatal('COMPOSIO_API_KEY is required')
if (!SUPABASE_URL)     fatal('NEXT_PUBLIC_SUPABASE_URL is required')
if (!SUPABASE_KEY)     fatal('SUPABASE_SERVICE_ROLE_KEY is required')
if (!OPERATOR_USER_ID) fatal('NEXUS_OPERATOR_USER_ID or ALLOWED_USER_IDS must be set so we know whose admin scope to load')

// ── Admin-scope account loader ───────────────────────────────────────────────
interface AdminAccount {
  platform:             string
  composio_account_id:  string
  last_used_at:         string | null
}

async function loadAdminAccounts(): Promise<Map<string, AdminAccount>> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/connected_accounts`)
  url.searchParams.set('select', 'platform,composio_account_id,last_used_at')
  url.searchParams.set('user_id',       `eq.${OPERATOR_USER_ID}`)
  url.searchParams.set('business_slug', `eq._admin`)
  url.searchParams.set('status',        `eq.active`)

  const res = await fetch(url.toString(), {
    headers: {
      apikey:          SUPABASE_KEY,
      Authorization:   `Bearer ${SUPABASE_KEY}`,
      Accept:          'application/json',
    },
  })
  if (!res.ok) {
    fatal(`Supabase fetch failed: ${res.status} ${await res.text().catch(() => '')}`)
  }
  const rows = (await res.json()) as AdminAccount[]
  const m = new Map<string, AdminAccount>()
  for (const r of rows) m.set(r.platform, r)
  return m
}

// ── Composio REST helpers ────────────────────────────────────────────────────
async function composioListActions(toolkitSlug: string): Promise<unknown> {
  const url = `${COMPOSIO_BASE}/api/v3/tools?toolkit=${encodeURIComponent(toolkitSlug.toUpperCase())}&limit=50`
  const res = await fetch(url, {
    headers: { 'x-api-key': COMPOSIO_API_KEY, Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Composio list-actions failed: ${res.status} ${await res.text().catch(() => '')}`)
  }
  return res.json()
}

async function composioExecute(actionSlug: string, connectedAccountId: string, args: unknown): Promise<unknown> {
  const url = `${COMPOSIO_BASE}/api/v3/tools/execute/${encodeURIComponent(actionSlug.toUpperCase())}`
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'x-api-key':   COMPOSIO_API_KEY,
      'Content-Type': 'application/json',
      Accept:        'application/json',
    },
    body: JSON.stringify({
      connected_account_id: connectedAccountId,
      arguments:            args ?? {},
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(`Composio execute failed: ${res.status} ${text.slice(0, 500)}`)
  }
  try { return JSON.parse(text) } catch { return { raw: text } }
}

// ── MCP server ───────────────────────────────────────────────────────────────
async function main() {
  const accounts = await loadAdminAccounts()
  console.error(`[composio-admin] Loaded ${accounts.size} admin-scope account(s): ${[...accounts.keys()].join(', ') || '(none)'}`)

  const server = new Server(
    { name: 'composio-admin', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'admin_list_connected_platforms',
        description: 'List the platforms connected in the Nexus Admin scope (business_slug=\'_admin\'). Returns an array of platform slugs (e.g. ["vercel","github","stripe","slack"]) plus last-used metadata. Call this BEFORE invoking admin_execute_action to confirm the platform is available — invoking against an unconnected platform errors with a clear message.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'admin_list_actions',
        description: 'List the Composio action slugs available for a given platform (toolkit). Use this to discover what operations exist before composing an admin_execute_action call. Wraps Composio\'s tools-list API.',
        inputSchema: {
          type: 'object',
          properties: { platform: { type: 'string', description: 'Platform slug, e.g. "vercel", "github", "stripe", "slack". Must be in the admin scope (use admin_list_connected_platforms to confirm).' } },
          required: ['platform'],
          additionalProperties: false,
        },
      },
      {
        name: 'admin_execute_action',
        description: 'Execute a Composio action against the admin-scope connected account for a platform. Hard-isolated — the connected_account_id is resolved server-side from the admin-scope row, the caller cannot specify it. Use for read operations freely; before any write action (Slack send, Stripe refund, Vercel deploy, GitHub merge/push, env mutation), surface the planned call to the operator and wait for explicit approval per the platform-copilot agent spec.',
        inputSchema: {
          type: 'object',
          properties: {
            platform: { type: 'string', description: 'Platform slug — must be in admin scope.' },
            action:   { type: 'string', description: 'Composio action slug, e.g. "VERCEL_LIST_DEPLOYMENTS". Case-normalised to UPPER on send.' },
            args:     { type: 'object', description: 'Action arguments per Composio\'s schema. Optional — omit for actions that take no args.', additionalProperties: true },
          },
          required: ['platform', 'action'],
          additionalProperties: false,
        },
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params
    const args = (rawArgs ?? {}) as Record<string, unknown>

    if (name === 'admin_list_connected_platforms') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(
            [...accounts.values()].map(a => ({
              platform:     a.platform,
              last_used_at: a.last_used_at,
            })),
            null, 2,
          ),
        }],
      }
    }

    if (name === 'admin_list_actions') {
      const platform = String(args.platform ?? '').toLowerCase().trim()
      if (!platform)              throw new Error('platform is required')
      const account = accounts.get(platform)
      if (!account)               throw new Error(`platform '${platform}' is not in admin scope. Connect it at /settings/accounts → Admin first, then redeploy the gateway.`)
      try {
        const data = await composioListActions(platform)
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `error: ${msg}` }], isError: true }
      }
    }

    if (name === 'admin_execute_action') {
      const platform = String(args.platform ?? '').toLowerCase().trim()
      const action   = String(args.action ?? '').trim()
      if (!platform)              throw new Error('platform is required')
      if (!action)                throw new Error('action is required')
      const account = accounts.get(platform)
      if (!account)               throw new Error(`platform '${platform}' is not in admin scope. Connect it at /settings/accounts → Admin first, then redeploy the gateway. Available admin platforms: ${[...accounts.keys()].join(', ') || '(none)'}.`)
      try {
        const data = await composioExecute(action, account.composio_account_id, args.args)
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `error: ${msg}` }], isError: true }
      }
    }

    throw new Error(`unknown tool: ${name}`)
  })

  await server.connect(new StdioServerTransport())
  console.error('[composio-admin] MCP server ready (stdio transport)')
}

main().catch(err => { console.error('[composio-admin] fatal:', err); process.exit(1) })
