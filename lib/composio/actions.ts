/**
 * Per-business Composio action helper.
 *
 * Replaces direct `executeAction()` calls when the action needs an OAuth-
 * connected user account (Twitter/LinkedIn/Gmail/etc.). Looks up the right
 * `connected_account_id` for the business, calls Composio, updates last-used.
 *
 * Resolution order for `connected_account_id`:
 *   1. exact (user_id, business_slug, platform) match
 *   2. user-default (user_id, NULL business_slug, platform) fallback
 *   3. throws ConnectedAccountMissingError otherwise
 *
 * Callers (workflow agents, cron jobs) should catch
 * ConnectedAccountMissingError and surface a "connect <platform>" prompt
 * to the owner via the Board, rather than failing the whole run.
 */

import { executeAction, ComposioError } from './client'
import { createServerClient } from '@/lib/supabase'
import { getProvider } from '@/lib/oauth/providers'
import { ADMIN_SCOPE } from '@/lib/claw/business-client'
import { isLeanMode } from '@/lib/lean-mode'
import { getFixtureModeSync } from '@/lib/fixtures/store'
import { getFixtureAction } from '@/lib/fixtures/actions'

export class ConnectedAccountMissingError extends Error {
  platform: string
  businessSlug: string | null
  constructor(platform: string, businessSlug: string | null) {
    super(`No active connected account for platform=${platform}${businessSlug ? `, business=${businessSlug}` : ''}`)
    this.name = 'ConnectedAccountMissingError'
    this.platform = platform
    this.businessSlug = businessSlug
  }
}

export interface ExecuteBusinessActionInput {
  userId:        string
  businessSlug:  string | null
  platform:      string
  action:        string
  arguments:     Record<string, unknown>
  /** Override timeout in ms (default 20s). */
  timeoutMs?:    number
}

interface AccountRow {
  id:                  string
  composio_account_id: string
}

async function findActiveAccount(
  userId: string,
  businessSlug: string | null,
  platform: string,
): Promise<AccountRow | null> {
  const db = createServerClient()
  if (!db) return null

  // Lean mode — skip the per-business exact match and go straight to the
  // user-default row. There's one tenant; partitioning by business_slug is
  // overhead. Admin scope still goes through the strict admin path below.
  if (isLeanMode() && businessSlug !== ADMIN_SCOPE) {
    type DefaultChain = { eq: (c: string, v: unknown) => DefaultChain; is: (c: string, v: null) => DefaultChain; limit: (n: number) => Promise<{ data: AccountRow[] | null }> }
    const def = await ((db.from('connected_accounts' as never) as unknown as {
      select: (cols: string) => DefaultChain
    }).select('id, composio_account_id')
      .eq('user_id', userId)
      .eq('platform', platform)
      .eq('status', 'active')
      .is('business_slug', null) as DefaultChain).limit(1)
    return def.data?.[0] ?? null
  }

  type Chain = { eq: (col: string, val: unknown) => Chain; limit: (n: number) => Promise<{ data: AccountRow[] | null }> }
  const exact = await ((db.from('connected_accounts' as never) as unknown as {
    select: (cols: string) => Chain
  }).select('id, composio_account_id')
    .eq('user_id', userId)
    .eq('platform', platform)
    .eq('status', 'active')
    .eq('business_slug', businessSlug ?? null) as Chain).limit(1)

  if (exact.data && exact.data.length > 0) return exact.data[0]

  // Fallback to user-default (business_slug IS NULL) only if a business slug
  // was requested AND it's not the admin sentinel. Admin scope is strict
  // by design — falling through would let platform-copilot accidentally
  // use a customer-context token.
  if (businessSlug && businessSlug !== ADMIN_SCOPE) {
    type DefaultChain = { eq: (c: string, v: unknown) => DefaultChain; is: (c: string, v: null) => DefaultChain; limit: (n: number) => Promise<{ data: AccountRow[] | null }> }
    const fallback = await ((db.from('connected_accounts' as never) as unknown as {
      select: (cols: string) => DefaultChain
    }).select('id, composio_account_id')
      .eq('user_id', userId)
      .eq('platform', platform)
      .eq('status', 'active')
      .is('business_slug', null) as DefaultChain).limit(1)
    if (fallback.data && fallback.data.length > 0) return fallback.data[0]
  }

  return null
}

/**
 * Execute a Composio action on behalf of a business. Resolves the right
 * connected_account_id, calls Composio, bumps last_used_at on success.
 *
 * Throws ConnectedAccountMissingError if no active connection exists, or
 * ComposioError if the upstream call fails.
 */
export async function executeBusinessAction(input: ExecuteBusinessActionInput): Promise<unknown> {
  if (!getProvider(input.platform)) {
    throw new Error(`Unknown platform: ${input.platform}`)
  }

  // Simulation safety: when the target business is flagged simulation=true,
  // refuse money-moving / customer-facing actions. The chaos harness exists
  // exactly so agents can practice WITHOUT touching real Stripe / real
  // recipients. classifyMoneyMovingVerb returns null for read-only / safe
  // actions so they still go through.
  if (input.businessSlug) {
    const { isSimulationBusiness, classifyMoneyMovingVerb, SimulationGuardError } =
      await import('@/lib/simulation/check')
    const category = classifyMoneyMovingVerb(input.action)
    if (category && await isSimulationBusiness(input.businessSlug)) {
      throw new SimulationGuardError(input.action, input.businessSlug, category)
    }
  }

  // Dev fixture harness — when the operator has fixture mode enabled
  // (per-user flag, migration 084), short-circuit Composio entirely and
  // return canned responses keyed by (platform, action). Lets the
  // operator exercise the full UI flow (chat, smoke, graduate, board
  // updates) without connecting a single real OAuth account.
  //
  // The sync check is intentional — getFixtureModeSync reads from the
  // 30s cache so most calls are zero-cost. First call after a flip
  // falls through to real Composio for one request (acceptable trade
  // for keeping the hot path sync). The /api/dev/fixtures/active PATCH
  // endpoint warms the cache so explicit toggles land immediately.
  if (getFixtureModeSync(input.userId)) {
    const fixtureFn = getFixtureAction(input.platform, input.action)
    if (fixtureFn) {
      return fixtureFn(input.arguments)
    }
    // Fixture mode is ON but no fixture for this (platform, action).
    // Falling through to real Composio defeats the purpose — surface
    // a clear error so the operator knows to add a fixture entry.
    throw new Error(`fixture_mode_no_fixture_for ${input.platform}:${input.action} — add an entry in lib/fixtures/actions.ts FIXTURE_ACTIONS`)
  }

  // LOCAL_MODE — operator runs Nexus as a personal-OS install. Composio
  // isn't reachable (the broker config lives in Doppler, which local mode
  // bypasses). Surface a clear error so the calling agent shows a
  // "connect <platform>" prompt rather than failing on a missing
  // connected_account lookup that wouldn't make sense locally.
  const { isLocalMode } = await import('@/lib/platform/local-mode')
  if (isLocalMode()) {
    throw new ConnectedAccountMissingError(input.platform, input.businessSlug ?? null)
  }

  const account = await findActiveAccount(input.userId, input.businessSlug, input.platform)
  if (!account) {
    throw new ConnectedAccountMissingError(input.platform, input.businessSlug)
  }

  const result = await executeAction({
    action:             input.action,
    connectedAccountId: account.composio_account_id,
    arguments:          input.arguments,
    timeoutMs:          input.timeoutMs,
    userId:             input.userId,   // Composio v3 requires user_id with a connected account
  })

  // Fire-and-forget last_used_at bump; never block the action result on this.
  const db = createServerClient()
  if (db) {
    void (db.from('connected_accounts' as never) as unknown as {
      update: (p: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> }
    }).update({ last_used_at: new Date().toISOString() }).eq('id', account.id)
  }

  return result
}

/**
 * Execute a Composio action in the **Admin scope** — used by the platform-
 * copilot for platform-management work (Vercel deploys of the nexus project,
 * GitHub operations on pinnacleadvisors/nexus, #ops Slack alerts, etc.).
 *
 * Resolution is strict — ONLY business_slug='_admin' rows. NEVER falls
 * through to NULL or per-business. That's the safety guarantee: platform-
 * copilot can't accidentally use a customer-context token, and a misbehaving
 * business agent can't accidentally reach an admin token by passing
 * businessSlug='_admin' (the executeBusinessAction path doesn't even look
 * at admin rows).
 */
export interface ExecuteAdminActionInput {
  userId:    string
  platform:  string
  action:    string
  arguments: Record<string, unknown>
  timeoutMs?: number
}

export async function executeAdminAction(input: ExecuteAdminActionInput): Promise<unknown> {
  if (!getProvider(input.platform)) {
    throw new Error(`Unknown platform: ${input.platform}`)
  }

  const account = await findActiveAccount(input.userId, ADMIN_SCOPE, input.platform)
  if (!account) {
    throw new ConnectedAccountMissingError(input.platform, ADMIN_SCOPE)
  }

  const result = await executeAction({
    action:             input.action,
    connectedAccountId: account.composio_account_id,
    arguments:          input.arguments,
    timeoutMs:          input.timeoutMs,
    userId:             input.userId,   // Composio v3 requires user_id with a connected account
  })

  const db = createServerClient()
  if (db) {
    void (db.from('connected_accounts' as never) as unknown as {
      update: (p: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> }
    }).update({ last_used_at: new Date().toISOString() }).eq('id', account.id)
  }

  return result
}

export { ComposioError }
