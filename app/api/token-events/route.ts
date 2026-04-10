import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

// ── Token event logging ───────────────────────────────────────────────────────
// Call this from any server-side code that invokes an AI model to track usage.
//
// POST /api/token-events
// Body: { agentId?, model, inputTokens, outputTokens }
//
// Cost is estimated automatically based on model pricing.

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6':          { input: 3.00 / 1e6,  output: 15.00 / 1e6 },
  'claude-opus-4-6':            { input: 15.00 / 1e6, output: 75.00 / 1e6 },
  'claude-haiku-4-5-20251001':  { input: 0.25 / 1e6,  output: 1.25 / 1e6 },
  'gpt-4o':                     { input: 5.00 / 1e6,  output: 15.00 / 1e6 },
  'gpt-4o-mini':                { input: 0.15 / 1e6,  output: 0.60 / 1e6 },
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_COSTS[model] ?? { input: 0, output: 0 }
  return pricing.input * inputTokens + pricing.output * outputTokens
}

export async function POST(req: NextRequest) {
  let body: {
    agentId?: string
    model: string
    inputTokens: number
    outputTokens: number
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { agentId, model, inputTokens, outputTokens } = body
  if (!model || inputTokens == null || outputTokens == null) {
    return NextResponse.json({ error: 'model, inputTokens, outputTokens required' }, { status: 400 })
  }

  const costUsd = estimateCost(model, inputTokens, outputTokens)

  const db = createServerClient()
  if (!db) {
    // Supabase not configured — log to console and return the estimated cost
    console.log(`[token-events] ${model} ${inputTokens}in/${outputTokens}out = $${costUsd.toFixed(6)}`)
    return NextResponse.json({ costUsd, logged: false })
  }

  // Persist the event
  const { error } = await db.from('token_events').insert({
    agent_id: agentId ?? null,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Also roll up the cost onto the agent row if an agent ID was given
  if (agentId) {
    try {
      await db.rpc('increment_agent_cost', {
        p_agent_id: agentId,
        p_tokens: inputTokens + outputTokens,
        p_cost: costUsd,
      })
    } catch {
      // RPC may not exist yet — silently ignore
    }
  }

  return NextResponse.json({ costUsd, logged: true })
}
