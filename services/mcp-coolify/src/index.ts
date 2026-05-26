/**
 * @nexus/mcp-coolify — bounded Coolify access for the platform-copilot.
 *
 * Tools exposed (read-only fire freely; writes proposed via the chat's
 * approval-request flow):
 *   READ:
 *     coolify_list_apps
 *     coolify_get_app
 *     coolify_get_logs
 *     coolify_list_env_keys      ← keys-only, values never returned
 *     coolify_get_env_value      ← gated (returns value, redacted in audit)
 *   WRITE:
 *     coolify_redeploy
 *     coolify_restart
 *     coolify_start
 *     coolify_stop
 *     coolify_set_env            ← value redacted in audit
 *     coolify_delete_env
 *
 * Three structural guards apply BEFORE every call:
 *   1. Kill switch — if `coolify_kill_switch.status='revoked'` the call
 *      fails with a clear "operator revoked access" message.
 *   2. Rate limit — max 5 writes/min and 30 writes/hour per user (reads
 *      don't count). Logged action="<tool>" result="rate_limited".
 *   3. Protected UUIDs — write calls against any uuid in PROTECTED_UUIDS
 *      env (comma-separated) are refused. Default list includes the
 *      claude-gateway + codex-gateway uuids so the agent can never stop
 *      the surface it's running on.
 *
 * Required env (set by the gateway entrypoint):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   NEXUS_OPERATOR_USER_ID
 *   COOLIFY_KVM4_URL
 *   COOLIFY_KVM4_API_TOKEN
 * Optional:
 *   NEXUS_JOB_ID            — gateway turn correlation (PR #189 pattern)
 *   PROTECTED_UUIDS         — comma-separated CSV of "do not touch" uuids
 *   COOLIFY_RATE_LIMIT_MIN  — override rate-limit per-minute (default 5)
 *   COOLIFY_RATE_LIMIT_HOUR — override rate-limit per-hour   (default 30)
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
const COOLIFY_URL       = (process.env.COOLIFY_KVM4_URL ?? '').replace(/\/$/, '')
const COOLIFY_TOKEN     = process.env.COOLIFY_KVM4_API_TOKEN ?? ''
const JOB_ID            = process.env.NEXUS_JOB_ID ?? null
const PROTECTED_UUIDS   = new Set((process.env.PROTECTED_UUIDS ?? '').split(',').map(s => s.trim()).filter(Boolean))
const RATE_PER_MIN      = Number(process.env.COOLIFY_RATE_LIMIT_MIN  ?? 5)
const RATE_PER_HOUR     = Number(process.env.COOLIFY_RATE_LIMIT_HOUR ?? 30)

// Scope under which this MCP instance operates. Set per-gateway:
//   - claude-gateway (KVM4)            → 'admin' (default; full access)
//   - per-business gateway (provisioner) → 'business:<slug>' (scoped to
//                                          that business's containers)
// 'admin' sees every app subject to PROTECTED_UUIDS on writes.
// 'business:<slug>' filters list responses + refuses calls against
// uuids that don't match the business's name pattern or custom_labels.
const SCOPE_RAW = (process.env.COOLIFY_SCOPE ?? 'admin').trim()
const SCOPE: 'admin' | { kind: 'business'; slug: string } =
  SCOPE_RAW === 'admin'
    ? 'admin'
    : SCOPE_RAW.startsWith('business:')
      ? { kind: 'business', slug: SCOPE_RAW.slice('business:'.length).trim() }
      : 'admin'

// Stamped on every audit insert so the /settings/accounts panel can
// filter the activity feed by scope.
const SCOPE_STR: string = SCOPE === 'admin' ? 'admin' : `business:${SCOPE.slug}`

function fatal(msg: string): never {
  console.error('[coolify] ' + msg)
  process.exit(2)
}
if (!SUPABASE_URL)     fatal('NEXT_PUBLIC_SUPABASE_URL is required')
if (!SUPABASE_KEY)     fatal('SUPABASE_SERVICE_ROLE_KEY is required')
if (!OPERATOR_USER_ID) fatal('NEXUS_OPERATOR_USER_ID or ALLOWED_USER_IDS[0] must be set')
if (!COOLIFY_URL)      fatal('COOLIFY_KVM4_URL is required')
if (!COOLIFY_TOKEN)    fatal('COOLIFY_KVM4_API_TOKEN is required')

// ── Supabase REST helpers (for kill switch + audit log) ─────────────────────
async function sbFetch(path: string, init: RequestInit = {}, opts: { timeoutMs?: number } = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
    headers: {
      apikey:          SUPABASE_KEY,
      Authorization:   `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      ...(init.headers ?? {}),
    },
  })
}

async function isKillSwitchActive(): Promise<boolean> {
  try {
    const res = await sbFetch(`/rest/v1/coolify_kill_switch?singleton=eq.true&select=status`)
    if (!res.ok) return false
    const rows = (await res.json()) as Array<{ status: string }>
    return rows[0]?.status === 'active'
  } catch { return false }
}

async function recentWriteCount(sinceMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - sinceMs).toISOString()
  // Scope-filtered count — admin and business budgets are independent so
  // a chatty business agent can't starve the platform-copilot's budget.
  const url = `/rest/v1/coolify_audit_log?user_id=eq.${encodeURIComponent(OPERATOR_USER_ID)}&scope=eq.${encodeURIComponent(SCOPE_STR)}&result=eq.success&created_at=gte.${cutoff}&action=not.like.coolify_list*&action=not.like.coolify_get*&select=id`
  try {
    const res = await sbFetch(url, { headers: { Prefer: 'count=exact' } })
    const range = res.headers.get('content-range') ?? '0-0/0'
    const total = Number(range.split('/').pop() ?? '0')
    return Number.isFinite(total) ? total : 0
  } catch { return 0 }
}

type AuditResult = 'success' | 'error' | 'rate_limited' | 'protected_uuid' | 'kill_switch' | 'unauthorized_scope'

// Map coolify's local AuditResult (the original schema) onto the unified
// tool_call_audit ToolCallStatus enum so the /audit page sees a consistent
// status across every MCP wrapper. 'success' is the only oddball — local
// schema predates 'ok' as the canonical success value.
function mapStatusForToolCallAudit(r: AuditResult): 'ok' | 'error' | 'rate_limited' | 'denied' | 'kill_switch' {
  if (r === 'success')             return 'ok'
  if (r === 'protected_uuid')      return 'denied'
  if (r === 'unauthorized_scope')  return 'denied'
  return r
}

// Audit sink — parallel write to `/api/audit/tool-call` on the parent Nexus
// app. Wired by the E3-partial follow-up (task_plan-platform-expansion.md)
// so the operator's /audit page sees Coolify alongside every other MCP. The
// existing coolify_audit_log table stays as-is (its richer schema with
// target_uuid / args_redacted is useful for the Coolify-only audit UI).
const AUDIT_BASE    = (process.env.NEXUS_AUDIT_BASE_URL ?? '').replace(/\/$/, '')
const AUDIT_TOKEN   = process.env.NEXUS_AUDIT_TOKEN ?? ''
const AGENT_SLUG    = process.env.NEXUS_AGENT_SLUG ?? 'platform-copilot'

async function recordToolCallAudit(input: {
  action:        string
  targetUuid:    string | null
  argsRedacted:  Record<string, unknown>
  result:        AuditResult
  errorMessage?: string
  durationMs?:   number
}): Promise<void> {
  if (!AUDIT_BASE) return
  try {
    await fetch(`${AUDIT_BASE}/api/audit/tool-call`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        ...(AUDIT_TOKEN ? { 'X-Audit-Token': AUDIT_TOKEN } : {}),
      },
      body:    JSON.stringify({
        mcp_server:    'coolify',
        agent_slug:    AGENT_SLUG,
        scope:         SCOPE_STR,
        user_id:       OPERATOR_USER_ID,
        tool_name:     input.action,
        args:          { ...input.argsRedacted, ...(input.targetUuid ? { uuid: input.targetUuid } : {}) },
        result_status: mapStatusForToolCallAudit(input.result),
        result:        input.errorMessage ? { error: input.errorMessage.slice(0, 1000) } : { ok: true },
        latency_ms:    input.durationMs ?? null,
      }),
      signal:  AbortSignal.timeout(5_000),
    })
  } catch (err) {
    console.warn('[coolify] tool-call audit POST failed:', err instanceof Error ? err.message : err)
  }
}

async function audit(input: { action: string; targetUuid: string | null; argsRedacted: Record<string, unknown>; result: AuditResult; errorMessage?: string; durationMs?: number }) {
  try {
    await sbFetch('/rest/v1/coolify_audit_log', {
      method: 'POST',
      body: JSON.stringify({
        user_id:       OPERATOR_USER_ID,
        job_id:        JOB_ID,
        scope:         SCOPE_STR,
        action:        input.action,
        target_uuid:   input.targetUuid,
        args_redacted: input.argsRedacted,
        result:        input.result,
        error_message: input.errorMessage ? input.errorMessage.slice(0, 1000) : null,
        duration_ms:   input.durationMs ?? null,
      }),
    })
  } catch (err) { console.error('[coolify/audit]', err instanceof Error ? err.message : err) }
  // Fire-and-forget the unified tool_call_audit row in parallel — defense in
  // depth so even when the coolify_audit_log write succeeds, the unified
  // /audit page sees the same row. Order matters: this MUST come after the
  // local write so a coolify_audit_log failure doesn't block the call site.
  void recordToolCallAudit(input)
}

// ── Coolify REST wrapper ─────────────────────────────────────────────────────
async function coolify<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${COOLIFY_URL}/api/v1${path}`
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization:  `Bearer ${COOLIFY_TOKEN}`,
      'Content-Type': 'application/json',
      Accept:         'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`coolify ${init.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 300)}`)
  }
  if (res.status === 204) return undefined as unknown as T
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) return res.json() as Promise<T>
  return (await res.text()) as unknown as T
}

// ── Scope filtering ──────────────────────────────────────────────────────────

interface AppShape {
  uuid:          string
  name?:         string
  custom_labels?: string
}

/**
 * Decide whether a Coolify app is callable under the current scope.
 *   - admin           → always true (PROTECTED_UUIDS already handled in preGuard)
 *   - business:<slug> → true ONLY when the app's name starts with
 *                       `nexus-business-${slug}-` (the provisioner's naming
 *                       convention) OR custom_labels contains
 *                       `nexus.business.slug=${slug}` (manual labeling
 *                       fallback for hand-created apps).
 *
 * Used by both list_apps (filter response) and the write tools (refuse
 * non-matching uuids → audit result='unauthorized_scope').
 */
function isInScope(app: AppShape): boolean {
  if (SCOPE === 'admin') return true
  const slug   = SCOPE.slug
  const name   = app.name ?? ''
  const labels = (() => {
    if (!app.custom_labels) return ''
    try { return Buffer.from(app.custom_labels, 'base64').toString('utf8') } catch { return app.custom_labels }
  })()
  return name.startsWith(`nexus-business-${slug}-`)
      || name === `nexus-business-${slug}`
      || labels.includes(`nexus.business.slug=${slug}`)
}

/** Cache the list_apps response for ~5s so per-call uuid lookups don't
 *  hammer Coolify. Each tool call goes through guardScope() which uses
 *  this cache; the cache busts itself when stale.
 *
 *  The cache is at module scope (single-process MCP) and rebuilds on
 *  expiry — no eager refresh because some scopes have many apps. */
let appCache: { fetchedAt: number; apps: AppShape[] } | null = null
async function getScopedApps(): Promise<AppShape[]> {
  if (appCache && Date.now() - appCache.fetchedAt < 5_000) return appCache.apps
  try {
    const all = await coolify<AppShape[]>('/applications')
    appCache = { fetchedAt: Date.now(), apps: all }
    return all
  } catch (err) {
    console.error('[coolify/scope] list_apps failed', err instanceof Error ? err.message : err)
    return appCache?.apps ?? []
  }
}

async function uuidInScope(uuid: string): Promise<boolean> {
  if (SCOPE === 'admin') return true
  const apps = await getScopedApps()
  const app  = apps.find(a => a.uuid === uuid)
  if (!app) return false
  return isInScope(app)
}

// ── Policy guards ────────────────────────────────────────────────────────────
const READ_ACTIONS = new Set([
  'coolify_list_apps',
  'coolify_get_app',
  'coolify_get_logs',
  'coolify_list_env_keys',
  'coolify_get_env_value',
])

type GuardResult = { ok: true } | { ok: false; reason: AuditResult; message: string }
async function preGuard(action: string, targetUuid: string | null): Promise<GuardResult> {
  const active = await isKillSwitchActive()
  if (!active) return { ok: false, reason: 'kill_switch', message: 'Coolify access has been revoked from /settings/accounts. Re-enable from the same panel to use this tool.' }

  // Scope check fires for ANY targeted action (read or write). list_apps
  // doesn't target a uuid — it's filtered post-fetch in dispatch().
  if (targetUuid && SCOPE !== 'admin') {
    const allowed = await uuidInScope(targetUuid)
    if (!allowed) {
      return {
        ok:      false,
        reason:  'unauthorized_scope',
        message: `Target uuid ${targetUuid.slice(0, 8)}… isn't in this scope (business:${SCOPE.slug}). Per-business agents can only act on apps whose name starts with \`nexus-business-${SCOPE.slug}-\` or whose custom_labels contains \`nexus.business.slug=${SCOPE.slug}\`. List your scoped apps first with coolify_list_apps.`,
      }
    }
  }

  if (!READ_ACTIONS.has(action)) {
    if (targetUuid && PROTECTED_UUIDS.has(targetUuid)) {
      return { ok: false, reason: 'protected_uuid', message: `target uuid ${targetUuid} is in PROTECTED_UUIDS — refusing destructive action. Edit this in Coolify directly if you really need to change it.` }
    }
    const min  = await recentWriteCount(60_000)
    if (min >= RATE_PER_MIN)  return { ok: false, reason: 'rate_limited', message: `rate limit: ${RATE_PER_MIN} writes/min exceeded (this scope). Cool down or check /settings/accounts for unexpected activity.` }
    const hour = await recentWriteCount(60 * 60_000)
    if (hour >= RATE_PER_HOUR) return { ok: false, reason: 'rate_limited', message: `rate limit: ${RATE_PER_HOUR} writes/hour exceeded (this scope).` }
  }
  return { ok: true }
}

function redact(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args }
  if ('value' in out)       out.value       = '***'
  if ('env_value' in out)   out.env_value   = '***'
  return out
}

// Strip log content of obvious prompt-injection markers so tool output the
// agent reads can't masquerade as instructions. Defense-in-depth — agents
// should never treat log content as instructions but cheap insurance.
function sanitizeLogs(text: string): string {
  return text.replace(/(?:^|\n)\s*(?:ignore previous|new instructions|disregard the above|system:?)/gi, m => '\n[redacted-injection-marker]' + m.replace(/^.*?(ignore previous|new instructions|disregard|system)/i, ''))
}

// ── Tool dispatch ────────────────────────────────────────────────────────────
async function dispatch(toolName: string, args: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const targetUuid = typeof args.uuid === 'string' ? args.uuid : null
  const guard = await preGuard(toolName, targetUuid)
  if (!guard.ok) {
    await audit({ action: toolName, targetUuid, argsRedacted: redact(args), result: guard.reason, errorMessage: guard.message })
    return { ok: false, error: guard.message }
  }
  const t0 = Date.now()
  try {
    let data: unknown
    switch (toolName) {
      case 'coolify_list_apps': {
        // Admin sees everything; business scope filters to only the apps
        // this business owns. The cache already filters via getScopedApps,
        // but here we fetch fresh to reflect operator-side changes that
        // happen between the cached 5s window.
        const all = await coolify<AppShape[]>('/applications')
        appCache = { fetchedAt: Date.now(), apps: all }   // refresh cache too
        data = SCOPE === 'admin' ? all : all.filter(isInScope)
        break
      }
      case 'coolify_get_app':      data = await coolify(`/applications/${encodeURIComponent(String(args.uuid))}`); break
      case 'coolify_get_logs': {
        const lines = Number(args.lines ?? 200)
        const raw = await coolify<string>(`/applications/${encodeURIComponent(String(args.uuid))}/logs?lines=${lines}`)
        data = { logs: sanitizeLogs(typeof raw === 'string' ? raw : JSON.stringify(raw)) }
        break
      }
      case 'coolify_list_env_keys': {
        const rows = await coolify<Array<{ key: string; uuid: string }>>(`/applications/${encodeURIComponent(String(args.uuid))}/envs`)
        // Strip values — operator must approve coolify_get_env_value separately.
        data = rows.map(r => ({ key: r.key, uuid: r.uuid }))
        break
      }
      case 'coolify_get_env_value': {
        const rows = await coolify<Array<{ key: string; value: string }>>(`/applications/${encodeURIComponent(String(args.uuid))}/envs`)
        const row = rows.find(r => r.key === args.key)
        data = row ? { key: row.key, value: row.value } : { key: args.key, value: null }
        break
      }
      case 'coolify_redeploy': data = await coolify(`/deploy?uuid=${encodeURIComponent(String(args.uuid))}`, { method: 'POST' }); break
      case 'coolify_restart':  data = await coolify(`/applications/${encodeURIComponent(String(args.uuid))}/restart`, { method: 'POST' }); break
      case 'coolify_start':    data = await coolify(`/applications/${encodeURIComponent(String(args.uuid))}/start`, { method: 'POST' }); break
      case 'coolify_stop':     data = await coolify(`/applications/${encodeURIComponent(String(args.uuid))}/stop`, { method: 'POST' }); break
      case 'coolify_set_env': {
        const body = JSON.stringify({ key: String(args.key), value: String(args.value), is_literal: true })
        // Prefer PATCH (update) — falls back to POST (create) on 404.
        try { await coolify(`/applications/${encodeURIComponent(String(args.uuid))}/envs`, { method: 'PATCH', body }); data = { ok: true, op: 'updated' } }
        catch { await coolify(`/applications/${encodeURIComponent(String(args.uuid))}/envs`, { method: 'POST',  body }); data = { ok: true, op: 'created' } }
        break
      }
      case 'coolify_delete_env': {
        const rows = await coolify<Array<{ key: string; uuid: string }>>(`/applications/${encodeURIComponent(String(args.uuid))}/envs`)
        const row = rows.find(r => r.key === args.key)
        if (!row) { data = { ok: false, reason: 'not_found' }; break }
        await coolify(`/applications/${encodeURIComponent(String(args.uuid))}/envs/${encodeURIComponent(row.uuid)}`, { method: 'DELETE' })
        data = { ok: true, op: 'deleted' }
        break
      }
      default: return { ok: false, error: `unknown tool: ${toolName}` }
    }
    await audit({ action: toolName, targetUuid, argsRedacted: redact(args), result: 'success', durationMs: Date.now() - t0 })
    return { ok: true, data }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await audit({ action: toolName, targetUuid, argsRedacted: redact(args), result: 'error', errorMessage: message, durationMs: Date.now() - t0 })
    return { ok: false, error: message }
  }
}

// ── MCP wiring ───────────────────────────────────────────────────────────────
const server = new Server(
  { name: '@nexus/mcp-coolify', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

const TOOL_DEFS = [
  { name: 'coolify_list_apps',     desc: 'List all Coolify applications. Read-only, safe.',                                                                                                       props: {} },
  { name: 'coolify_get_app',       desc: 'Get details for one application by uuid.',                                                                                                              props: { uuid: { type: 'string' } }, required: ['uuid'] },
  { name: 'coolify_get_logs',      desc: 'Recent stdout/stderr lines from the running container. Prompt-injection markers in logs are sanitised before return.',                                  props: { uuid: { type: 'string' }, lines: { type: 'number', description: 'How many lines to fetch (default 200, max 1000).' } }, required: ['uuid'] },
  { name: 'coolify_list_env_keys', desc: 'Returns env var NAMES (no values) for an app. Use this for discovery; call coolify_get_env_value for a specific value when you actually need it.',     props: { uuid: { type: 'string' } }, required: ['uuid'] },
  { name: 'coolify_get_env_value', desc: 'Returns the value of ONE env var. Audited as a sensitive read. Propose this in an approval-request block if the value is operator-secret.',             props: { uuid: { type: 'string' }, key: { type: 'string' } }, required: ['uuid', 'key'] },
  { name: 'coolify_redeploy',      desc: 'Trigger a fresh deploy (pull image + redeploy). Use after merging a PR that needs to land in production. Refuses against PROTECTED_UUIDS.',             props: { uuid: { type: 'string' } }, required: ['uuid'] },
  { name: 'coolify_restart',       desc: 'Restart an existing app without re-pulling the image. Use for "wedged process" recovery.',                                                              props: { uuid: { type: 'string' } }, required: ['uuid'] },
  { name: 'coolify_start',         desc: 'Start a stopped app.',                                                                                                                                  props: { uuid: { type: 'string' } }, required: ['uuid'] },
  { name: 'coolify_stop',          desc: 'Stop a running app. Refuses against PROTECTED_UUIDS (the gateway containers).',                                                                          props: { uuid: { type: 'string' } }, required: ['uuid'] },
  { name: 'coolify_set_env',       desc: 'Add or update an env var. Value is redacted in the audit log. Propose via approval-request first.',                                                     props: { uuid: { type: 'string' }, key: { type: 'string' }, value: { type: 'string' } }, required: ['uuid', 'key', 'value'] },
  { name: 'coolify_delete_env',    desc: 'Remove an env var by key. Propose via approval-request first.',                                                                                          props: { uuid: { type: 'string' }, key: { type: 'string' } }, required: ['uuid', 'key'] },
]

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFS.map(t => ({
    name:        t.name,
    description: t.desc,
    inputSchema: { type: 'object', properties: t.props, required: t.required ?? [] },
  })),
}))

server.setRequestHandler(CallToolRequestSchema, async req => {
  const name = req.params.name
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  const result = await dispatch(name, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

new StdioServerTransport && server.connect(new StdioServerTransport()).then(() => {
  console.error('[coolify] ready')
}).catch(err => {
  console.error('[coolify] transport failed:', err)
  process.exit(2)
})
