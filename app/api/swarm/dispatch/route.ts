/**
 * POST /api/swarm/dispatch
 *
 * Starts a multi-agent swarm run and streams SSE events back to the client.
 *
 * Body: SwarmConfig
 * Response: text/event-stream — each line is `data: <JSON SwarmEvent>\n\n`
 * Headers: X-Swarm-Id: <uuid>
 *
 * Also persists swarm state to Supabase (fire-and-forget) for the status endpoint.
 */

import { NextRequest } from 'next/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { createServerClient } from '@/lib/supabase'
import { runSwarm } from '@/lib/swarm/Queen'
import type { SwarmConfig, SwarmEvent, ConsensusType, QueenType } from '@/lib/swarm/types'

export const maxDuration = 300   // 5 min — requires Vercel Pro / self-hosted
export const runtime     = 'nodejs'

// ── Supabase persistence helpers ──────────────────────────────────────────────
// Bypass Supabase's RejectExcessProperties generic for dynamic data rows.
// The shapes are correct at runtime — TS strictness is the only issue here.
function getDb() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createServerClient() as any
}

async function insertRun(swarmId: string, goal: string, data: Record<string, unknown>) {
  const db = getDb()
  if (!db) return
  const { error } = await db.from('swarm_runs').insert({ id: swarmId, goal, ...data })
  if (error) console.error('[swarm] insert run:', (error as { message: string }).message)
}

async function updateRun(swarmId: string, data: Record<string, unknown>) {
  const db = getDb()
  if (!db) return
  const { error } = await db.from('swarm_runs').update(data).eq('id', swarmId)
  if (error) console.error('[swarm] update run:', (error as { message: string }).message)
}

async function insertTasks(tasks: Array<Record<string, unknown>>) {
  const db = getDb()
  if (!db) return
  for (const task of tasks) {
    const { error } = await db.from('swarm_tasks').insert({
      id:          String(task.id ?? ''),
      swarm_id:    String(task.swarmId ?? ''),
      phase:       Number(task.phase ?? 0),
      title:       String(task.title ?? ''),
      description: String(task.description ?? ''),
      role:        String(task.role ?? ''),
      status:      String(task.status ?? 'pending'),
      result:      task.result ? String(task.result) : null,
      votes:       task.votes ?? null,
      tokens_used: task.tokensUsed ? Number(task.tokensUsed) : null,
      model:       task.model ? String(task.model) : null,
    })
    if (error) console.error('[swarm] insert task:', (error as { message: string }).message)
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Rate limit: 5 swarm runs per minute (they're expensive)
  const rl = await rateLimit(req, { limit: 5, window: '1 m', prefix: 'swarm' })
  if (!rl.success) return rateLimitResponse(rl)

  const body = await req.json() as SwarmConfig

  if (!body.goal?.trim()) {
    return new Response(JSON.stringify({ error: 'goal is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const swarmId      = crypto.randomUUID()
  const queenType:   QueenType     = body.queenType     ?? 'strategic'
  const consensusType: ConsensusType = body.consensusType ?? 'raft'

  audit(req, {
    action:     'swarm.dispatch',
    resource:   'swarm',
    resourceId: swarmId,
    metadata:   { goal: body.goal.slice(0, 100), queenType, consensusType, budgetUsd: body.budgetUsd },
  })

  // Persist initial run record
  await insertRun(swarmId, body.goal, {
    context:        body.context ?? null,
    queen_type:     queenType,
    consensus_type: consensusType,
    status:         'planning',
    budget_usd:     body.budgetUsd ?? null,
  })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: SwarmEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          // Controller already closed
        }
      }

      // Emit swarm ID so client can reference it
      emit({ type: 'status', swarmId, payload: { swarmId, status: 'planning' }, ts: Date.now() })

      try {
        await updateRun(swarmId, { status: 'running', updated_at: new Date().toISOString() })

        const result = await runSwarm({
          swarmId,
          goal:            body.goal,
          context:         body.context ?? '',
          consensusType,
          budgetUsd:       body.budgetUsd       ?? 5,
          driftThreshold:  body.driftThreshold  ?? 0.4,
          checkpointEvery: body.checkpointEvery ?? 5,
          emit,
        })

        // Persist completed state
        await updateRun(swarmId, {
          status:         'completed',
          phases:         result.phases as unknown as import('@/lib/database.types').Json,
          current_phase:  result.phases.length,
          total_tokens:   result.totalTokens,
          total_cost_usd: result.totalCostUsd.toFixed(6),
          completed_at:   new Date().toISOString(),
          updated_at:     new Date().toISOString(),
        })

        await insertTasks(result.tasks as Array<Record<string, unknown>>)

        emit({
          type:    'complete',
          swarmId,
          payload: {
            synthesis:    result.synthesis,
            totalTokens:  result.totalTokens,
            totalCostUsd: result.totalCostUsd.toFixed(4),
            phases:       result.phases.length,
            tasks:        result.tasks.length,
          },
          ts: Date.now(),
        })
      } catch (err) {
        const message = (err as Error).message ?? 'Swarm execution failed'
        console.error('[swarm] dispatch error:', err)

        await updateRun(swarmId, {
          status:     'failed',
          error:      message,
          updated_at: new Date().toISOString(),
        })

        emit({ type: 'error', swarmId, payload: { message }, ts: Date.now() })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Swarm-Id':    swarmId,
    },
  })
}
