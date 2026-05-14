/**
 * lib/claw/gateway-turns.ts — `gateway_turns` table accessors.
 *
 * Substrate for the bug-hunt loop's plan-window budget AND the Live
 * activity Views panel. One row per spawned `claude` / `codex` job.
 *
 * Inserts are fire-and-forget — if the row fails (Supabase down,
 * quota exhausted), the dispatch still succeeds and we just lose that
 * one accounting row. Better than blocking dispatch on accounting.
 *
 * Callers don't await — they fire `void insertGatewayTurn(...)` after
 * the job has finished and the dispatch result is in hand.
 */

import { createServerClient } from '@/lib/supabase'

export type GatewayPlan = 'claude-max' | 'codex-pro' | 'anthropic-api'

export interface InsertGatewayTurnInput {
  userId:           string
  plan:             GatewayPlan
  model?:           string | null
  sessionTag?:      string | null
  durationMs?:      number | null
  inputTokens?:     number | null
  outputTokens?:    number | null
  costEstimateUsd?: number | null
  toolCallsCount?:  number | null
}

export interface GatewayTurnRow {
  id:                string
  user_id:           string
  plan:              GatewayPlan
  model:             string | null
  session_tag:       string | null
  duration_ms:       number | null
  input_tokens:      number | null
  output_tokens:     number | null
  cost_estimate_usd: number | null
  tool_calls_count:  number | null
  created_at:        string
}

export async function insertGatewayTurn(input: InsertGatewayTurnInput): Promise<void> {
  const db = createServerClient()
  if (!db) return
  const row = {
    user_id:           input.userId,
    plan:              input.plan,
    model:             input.model           ?? null,
    session_tag:       input.sessionTag      ?? null,
    duration_ms:       input.durationMs      ?? null,
    input_tokens:      input.inputTokens     ?? null,
    output_tokens:     input.outputTokens    ?? null,
    cost_estimate_usd: input.costEstimateUsd ?? 0,
    tool_calls_count:  input.toolCallsCount  ?? 0,
  }
  try {
    await (db.from('gateway_turns' as never) as unknown as {
      insert: (r: typeof row) => Promise<{ error: unknown }>
    }).insert(row)
  } catch {
    // Swallow — accounting failures must never block dispatch.
  }
}

/**
 * Fetch all gateway_turns rows in the last `windowHours` hours for a user
 * on a specific plan. Used by the plan-window math to compute session vs
 * window share.
 */
export async function listTurnsInWindow(
  userId: string,
  plan: GatewayPlan,
  windowHours = 5,
): Promise<GatewayTurnRow[]> {
  const db = createServerClient()
  if (!db) return []
  const since = new Date(Date.now() - windowHours * 60 * 60_000).toISOString()
  const res = await (db.from('gateway_turns' as never) as unknown as {
    select: (c: string) => {
      eq:  (c: string, v: string) => {
        eq:  (c: string, v: string) => {
          gte: (c: string, v: string) => {
            order: (c: string, o: { ascending: boolean }) => Promise<{ data: GatewayTurnRow[] | null }>
          }
        }
      }
    }
  })
    .select('*')
    .eq('user_id', userId)
    .eq('plan', plan)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
  return res.data ?? []
}
