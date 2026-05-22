/**
 * claimIssue / releaseIssue — atomic issue checkout via the stored function
 * defined in migration 051_issue_checkout_fn.sql.
 *
 * Mirrors the lib/webhooks/idempotency.ts claimEvent() pattern: a single RPC
 * call returns either the claimed id or null. Two parallel callers receive
 * different issues (or one returns null) thanks to FOR UPDATE SKIP LOCKED.
 *
 * Fail-soft when the function doesn't exist yet (migration 051 not applied):
 * claimIssue returns null and logs once. No retry-storm.
 *
 * See: supabase/migrations/051_issue_checkout_fn.sql
 *      docs/research/paperclip-audit-2026-05.md §11.1 (PgBouncer rationale)
 *      task_plan-paperclip-absorption.md (Task 4c)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

let claimFnAvailable: boolean | null = null
let releaseFnAvailable: boolean | null = null

function isMissingFunction(name: string, message: string): boolean {
  if (!message) return false
  // PostgREST: `Could not find the function public.claim_issue ...` or `function ... does not exist`
  return new RegExp(`(function .*${name}.*does not exist|Could not find the function .*${name})`, 'i').test(message)
}

export interface ClaimedIssue {
  issue_id: string
}

export async function claimIssue(
  db: SupabaseClient<Database>,
  args: { business_slug: string; run_id: string; agent_slug?: string | null },
): Promise<ClaimedIssue | null> {
  if (claimFnAvailable === false) return null

  const rpc = (db as unknown as {
    rpc: (
      fn: string,
      params: Record<string, unknown>,
    ) => Promise<{ data: string | null; error: { message: string } | null }>
  }).rpc

  const res = await rpc('claim_issue', {
    p_business_slug: args.business_slug,
    p_run_id:        args.run_id,
    p_agent_slug:    args.agent_slug ?? null,
  })

  if (res.error) {
    if (isMissingFunction('claim_issue', res.error.message)) {
      if (claimFnAvailable === null) {
        console.warn(
          '[claimIssue] claim_issue function missing — apply migration 051_issue_checkout_fn. Returning null so dispatch path continues without lock.',
        )
      }
      claimFnAvailable = false
      return null
    }
    // Non-missing-function errors are real — surface them as null + a warning
    // (rather than throwing) so a transient PG hiccup doesn't tear down the
    // strategist tick.
    console.warn('[claimIssue] error:', res.error.message)
    return null
  }

  if (claimFnAvailable === null) claimFnAvailable = true
  if (!res.data) return null
  return { issue_id: res.data }
}

export async function releaseIssue(
  db: SupabaseClient<Database>,
  args: { issue_id: string; run_id: string },
): Promise<boolean> {
  if (releaseFnAvailable === false) return false

  const rpc = (db as unknown as {
    rpc: (
      fn: string,
      params: Record<string, unknown>,
    ) => Promise<{ data: boolean | null; error: { message: string } | null }>
  }).rpc

  const res = await rpc('release_issue', {
    p_issue_id: args.issue_id,
    p_run_id:   args.run_id,
  })

  if (res.error) {
    if (isMissingFunction('release_issue', res.error.message)) {
      if (releaseFnAvailable === null) {
        console.warn('[releaseIssue] release_issue function missing — apply migration 051_issue_checkout_fn.')
      }
      releaseFnAvailable = false
      return false
    }
    console.warn('[releaseIssue] error:', res.error.message)
    return false
  }

  if (releaseFnAvailable === null) releaseFnAvailable = true
  return res.data === true
}
