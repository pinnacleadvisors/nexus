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

  type Chain = { eq: (col: string, val: unknown) => Chain; limit: (n: number) => Promise<{ data: AccountRow[] | null }> }
  const exact = await ((db.from('connected_accounts' as never) as unknown as {
    select: (cols: string) => Chain
  }).select('id, composio_account_id')
    .eq('user_id', userId)
    .eq('platform', platform)
    .eq('status', 'active')
    .eq('business_slug', businessSlug ?? null) as Chain).limit(1)

  if (exact.data && exact.data.length > 0) return exact.data[0]

  // Fallback to user-default (business_slug IS NULL) only if a business slug was requested.
  if (businessSlug) {
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

  const account = await findActiveAccount(input.userId, input.businessSlug, input.platform)
  if (!account) {
    throw new ConnectedAccountMissingError(input.platform, input.businessSlug)
  }

  const result = await executeAction({
    action:             input.action,
    connectedAccountId: account.composio_account_id,
    arguments:          input.arguments,
    timeoutMs:          input.timeoutMs,
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

export { ComposioError }
