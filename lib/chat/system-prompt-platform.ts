/**
 * Platform-dev chat system prompt builder.
 *
 * The /manage-platform chat is the operator's developer copilot for the Nexus
 * platform ITSELF (not a per-business copilot — that's a separate flow).
 *
 * This prompt arms Claude with:
 *   - Repo + branch identity so file edits land in the right place
 *   - The operator's shared-scope connected accounts (business_slug IS NULL)
 *     so Claude knows which platforms it can read/write via the Composio MCP
 *   - Recent platform errors (run_events with status='error' in last 24h)
 *   - Active businesses so investigations can be scoped
 *
 * Re-built on every turn (cheap — <100 rows of supporting state). Stale
 * context is the bigger risk than the few-ms re-query cost.
 *
 * Companion file: lib/chat/approval-policy-platform.ts (Phase 3).
 */

import { createServerClient } from '@/lib/supabase'
import { ADMIN_SCOPE } from '@/lib/claw/business-client'

interface ConnectedAccountRow {
  platform:       string
  status:         string
  last_used_at:   string | null
}

interface RunEventRow {
  business_slug:  string | null
  phase:          string | null
  status:         string
  message:        string | null
  created_at:     string
}

interface BusinessRow {
  slug:           string
  name:           string | null
  niche:          string | null
}

/**
 * Build the platform-dev system prompt. Always returns a string — DB lookup
 * failures degrade gracefully to a partial prompt rather than throwing, so
 * the chat is never blocked by a transient Supabase issue.
 */
export async function buildPlatformSystemPrompt(userId: string): Promise<string> {
  const db = createServerClient()
  let connected: ConnectedAccountRow[] = []
  let errors:    RunEventRow[]         = []
  let businesses: BusinessRow[]        = []

  if (db) {
    try {
      type Result<T> = Promise<{ data: T[] | null; error: { message: string } | null }>
      type Chain<T> = { eq: (c: string, v: unknown) => Chain<T>; is: (c: string, v: unknown) => Chain<T>; order: (c: string, o: { ascending: boolean }) => Chain<T>; limit: (n: number) => Result<T>; gte: (c: string, v: unknown) => Chain<T> }

      // Admin-scope connections only (PR #151). The Shared (NULL) and per-
      // business connections aren't surfaced here — they belong to the
      // per-business agent surface, not platform-copilot.
      const connectedQ = (db.from('connected_accounts' as never) as unknown as { select: (c: string) => Chain<ConnectedAccountRow> })
        .select('platform, status, last_used_at')
        .eq('user_id', userId)
        .eq('business_slug', ADMIN_SCOPE)
        .eq('status', 'active')
        .order('last_used_at', { ascending: false })
        .limit(20)
      const connectedR = await connectedQ
      connected = connectedR.data ?? []

      const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
      const errorsQ = (db.from('run_events' as never) as unknown as { select: (c: string) => Chain<RunEventRow> })
        .select('business_slug, phase, status, message, created_at')
        .eq('status', 'error')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(10)
      const errorsR = await errorsQ
      errors = errorsR.data ?? []

      // Canonical table is `business_operators` (see lib/business/db.ts header).
      const businessesQ = (db.from('business_operators' as never) as unknown as { select: (c: string) => Chain<BusinessRow> })
        .select('slug, name, niche')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20)
      const businessesR = await businessesQ
      businesses = businessesR.data ?? []
    } catch { /* swallow — partial prompt is fine */ }
  }

  return renderPrompt({ connected, errors, businesses })
}

function renderPrompt(state: { connected: ConnectedAccountRow[]; errors: RunEventRow[]; businesses: BusinessRow[] }): string {
  const connectedList = state.connected.length === 0
    ? '  (none yet — operator should connect platforms at /settings/accounts under the **Admin** scope picker. Shared and per-business connections are not surfaced to you.)'
    : state.connected.map(a => `  - ${a.platform}${a.last_used_at ? ` (last used ${humanizeAge(a.last_used_at)})` : ''}`).join('\n')

  const businessList = state.businesses.length === 0
    ? '  (none yet)'
    : state.businesses.map(b => `  - ${b.slug}${b.name ? ` — ${b.name}` : ''}${b.niche ? ` (niche: ${b.niche})` : ''}`).join('\n')

  const errorList = state.errors.length === 0
    ? '  (no errors in the last 24h)'
    : state.errors.slice(0, 5).map(e => `  - [${humanizeAge(e.created_at)}] ${e.business_slug ?? 'platform'} / ${e.phase ?? '?'}: ${(e.message ?? 'no message').slice(0, 200)}`).join('\n')

  return `You are the developer copilot for the Nexus platform itself.

Codebase: github.com/pinnacleadvisors/nexus (cloned at /repo, branch: main)
Memory:   pinnacleadvisors/memory-hq (write atoms via the memory-hq MCP when
          you discover something durable — see AGENTS.md "Post-incident memory
          protocol")

Active businesses:
${businessList}

Connected platforms (operator's **Admin scope** — use via the Composio rube-mcp tools \`mcp__composio__*\`. These tokens are narrow-scoped to the Nexus platform itself: nexus Vercel project only, pinnacleadvisors/nexus GitHub repo only, #ops Slack channel only, etc. **Do NOT use these for per-business work** — those have separate tokens you can't see):
${connectedList}

MCP tool availability:
  - The hard-isolation Composio wrapper (\`mcp-composio-admin\`) is registered.
    Three tools exposed (all admin-scope only):
      mcp__composio-admin__admin_list_connected_platforms()
      mcp__composio-admin__admin_list_actions({platform})
      mcp__composio-admin__admin_execute_action({platform, action, args?})
    Typical loop: list_platforms → list_actions → execute_action.
  - If you only see \`mcp__composio__*\` (no \`-admin\` suffix), the wrapper
    failed to build at boot and the gateway fell back to rube-mcp with
    all-scope visibility. In that fallback mode you MUST self-discipline
    to admin-scope connections (the data list above is still admin-only,
    so use it as your ground truth). Check the gateway deploy logs to
    confirm which mode is active and surface the fallback to the operator.
  - If a platform you expected is not in admin_list_connected_platforms,
    the operator hasn't connected it yet. Tell them: \"connect <platform>
    in /settings/accounts → Admin scope, then redeploy the gateway so the
    MCP picks it up\".

Recent platform errors (last 24h, max 5 shown):
${errorList}

Gateways available:
  - You're running on the shared claude-gateway (KVM4)
  - For execution-heavy work (sysadmin, Coolify health, container debugging,
    fresh-state SaaS research, full-stack smoke tests), you can delegate to
    codex-gateway on KVM2. Use it when the task is shell-heavy or needs
    sandboxed experimentation — don't try to do those yourself.

Interactive rules:
  1. When the operator asks an investigation question, fetch the relevant
     platform data via Composio BEFORE answering. Don't speculate when a
     real API call can give you the truth.
  2. When the operator asks to make a code change, propose a plan first
     (files to touch, why, risks). Wait for explicit go-ahead before
     editing — even if they said "just do it", confirm the plan once.
  3. State what you found / what you did clearly. Use markdown.
  4. ALWAYS ask for explicit approval before any of: deploy, force-push,
     env-var write, customer-facing message send, refund/payment action,
     container destroy/restart, secret rotation. These are platform-side
     destructive — never do them silently.
  5. Fail visibly. When something errors, report the full error text and
     suggest 2-3 concrete next steps. Never quietly swallow exceptions.
  6. You are interactive, not autonomous. Stop and ask whenever scope
     creeps beyond what the operator explicitly authorised.

When you discover a non-trivial root cause or pattern worth preserving
across sessions, write a memory-hq atom (importance: 'high' for incidents,
'normal' for facts) before ending the conversation.`
}

function humanizeAge(iso: string): string {
  const ms  = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1)         return 'just now'
  if (min < 60)        return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr  < 24)        return `${hr}h ago`
  const d  = Math.floor(hr  / 24)
  return `${d}d ago`
}
