/**
 * Per-business chat system prompt builder (Phase 5a of task_plan-chat.md).
 *
 * Parallel to lib/chat/system-prompt-platform.ts but scoped to one business:
 *   - Connected platforms pulled from connected_accounts where
 *     business_slug = <slug>, plus the operator's Shared (NULL) row as
 *     fallback so the agent knows about both layers
 *   - Recent errors filtered to that business's run_events
 *   - Niche + money_model from the businesses row (for context)
 *
 * Re-built on every turn — same cheap DB lookup pattern as the platform
 * prompt builder. DB failures degrade to a partial prompt rather than
 * throwing so a transient Supabase issue never blocks chat.
 */

import { createServerClient } from '@/lib/supabase'

interface ConnectedAccountRow {
  platform:      string
  status:        string
  last_used_at:  string | null
  business_slug: string | null
}

interface RunEventRow {
  phase:       string | null
  status:      string
  message:     string | null
  created_at:  string
}

interface BusinessRow {
  slug:         string
  name:         string | null
  niche:        string | null
  money_model:  string | null
}

export async function buildBusinessSystemPrompt(userId: string, businessSlug: string): Promise<string> {
  const db = createServerClient()
  let connected: ConnectedAccountRow[] = []
  let errors: RunEventRow[]             = []
  let biz: BusinessRow | null           = null

  if (db) {
    try {
      type Chain<T> = { eq: (c: string, v: unknown) => Chain<T>; is: (c: string, v: unknown) => Chain<T>; order: (c: string, o: { ascending: boolean }) => Chain<T>; limit: (n: number) => Promise<{ data: T[] | null; error: { message: string } | null }>; gte: (c: string, v: unknown) => Chain<T> }

      const bizQ = (db.from('businesses' as never) as unknown as { select: (c: string) => Chain<BusinessRow> })
        .select('slug, name, niche, money_model')
        .eq('slug', businessSlug)
        .eq('user_id', userId)
        .limit(1)
      const bizR = await bizQ
      biz = bizR.data?.[0] ?? null

      const perBizQ = (db.from('connected_accounts' as never) as unknown as { select: (c: string) => Chain<ConnectedAccountRow> })
        .select('platform, status, last_used_at, business_slug')
        .eq('user_id', userId)
        .eq('business_slug', businessSlug)
        .eq('status', 'active')
        .order('last_used_at', { ascending: false })
        .limit(15)
      const sharedQ = (db.from('connected_accounts' as never) as unknown as { select: (c: string) => Chain<ConnectedAccountRow> })
        .select('platform, status, last_used_at, business_slug')
        .eq('user_id', userId)
        .is('business_slug', null)
        .eq('status', 'active')
        .order('last_used_at', { ascending: false })
        .limit(15)
      const [perBiz, shared] = await Promise.all([perBizQ, sharedQ])
      connected = [...(perBiz.data ?? []), ...(shared.data ?? [])]

      const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
      const errQ = (db.from('run_events' as never) as unknown as { select: (c: string) => Chain<RunEventRow> })
        .select('phase, status, message, created_at')
        .eq('business_slug', businessSlug)
        .eq('status', 'error')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(10)
      const errR = await errQ
      errors = errR.data ?? []
    } catch { /* swallow */ }
  }
  return renderPrompt({ biz, businessSlug, connected, errors })
}

function renderPrompt(state: { biz: BusinessRow | null; businessSlug: string; connected: ConnectedAccountRow[]; errors: RunEventRow[] }): string {
  const perBiz = state.connected.filter(c => c.business_slug === state.businessSlug)
  const shared = state.connected.filter(c => c.business_slug === null)
  const perBizList = perBiz.length === 0
    ? '  (none yet — operator can connect at /settings/accounts → pick this business)'
    : perBiz.map(a => `  - ${a.platform}${a.last_used_at ? ` (last used ${humanizeAge(a.last_used_at)})` : ''}`).join('\n')
  const sharedList = shared.length === 0
    ? '  (none — operator should connect at /settings/accounts → Shared)'
    : shared.map(a => `  - ${a.platform} (shared)${a.last_used_at ? ` (last used ${humanizeAge(a.last_used_at)})` : ''}`).join('\n')
  const errList = state.errors.length === 0
    ? '  (no errors in the last 24h)'
    : state.errors.slice(0, 5).map(e => `  - [${humanizeAge(e.created_at)}] ${e.phase ?? '?'}: ${(e.message ?? 'no message').slice(0, 200)}`).join('\n')
  const name       = state.biz?.name        ?? state.businessSlug
  const niche      = state.biz?.niche       ?? '(unknown)'
  const moneyModel = state.biz?.money_model ?? '(unknown)'

  return `You are the in-platform copilot for the business "${name}" (slug: ${state.businessSlug}).

Niche:       ${niche}
Money model: ${moneyModel}

Per-business connected platforms (use these FIRST — Composio MCP fallback
chain resolves these by slug):
${perBizList}

Shared platforms (Shopify Plus, Canva Pro, etc. — used when a per-business
connection isn't present):
${sharedList}

Recent run errors for this business (last 24h):
${errList}

Interactive rules:
  1. When the operator asks an investigation question, fetch the relevant
     platform data via Composio BEFORE answering.
  2. When the operator asks for a change, propose a plan first with steps
     + risks. Wait for explicit approval (use the \`approval-request\`
     fenced JSON block format — see chat UI) before destructive actions:
     outbound customer messages, refunds, content publishes, product
     mutations, ad spend, deletion of customer/product/order records.
  3. Tag every Stripe / customer / product mutation with
     \`metadata.business_slug='${state.businessSlug}'\` so revenue
     attribution stays clean across businesses sharing one Stripe.
  4. NEVER touch the Nexus platform itself (codebase, deploys, admin-scope
     tokens). That's the platform-copilot's job. If the operator asks a
     platform-level question, suggest switching to /manage-platform.
  5. Fail visibly. State findings + actions clearly with markdown.`
}

function humanizeAge(iso: string): string {
  const ms  = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}
