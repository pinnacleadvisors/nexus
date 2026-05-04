import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { sendSlackOrEmail } from '@/lib/alert-dispatch'
import type { AlertThreshold } from '@/lib/types'

export const runtime = 'nodejs'

// DB columns are free-text (no CHECK constraints); narrow the read here so
// the rest of the codebase can rely on the literal-union types in lib/types.ts.
const VALID_METRICS = new Set<AlertThreshold['metric']>(['daily_cost', 'error_rate', 'agent_down'])
const VALID_CHANNELS = new Set<AlertThreshold['channel']>(['email', 'slack'])

function narrowMetric(value: string): AlertThreshold['metric'] {
  return VALID_METRICS.has(value as AlertThreshold['metric'])
    ? (value as AlertThreshold['metric'])
    : 'daily_cost'
}
function narrowChannel(value: string): AlertThreshold['channel'] {
  return VALID_CHANNELS.has(value as AlertThreshold['channel'])
    ? (value as AlertThreshold['channel'])
    : 'email'
}

// ── GET — list thresholds ─────────────────────────────────────────────────────
export async function GET() {
  const db = createServerClient()
  if (!db) return NextResponse.json({ thresholds: [], source: 'unconfigured' })

  const { data, error } = await db
    .from('alert_thresholds')
    .select('*')
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const thresholds: AlertThreshold[] = (data ?? [])
    .filter(r => VALID_METRICS.has(r.metric as AlertThreshold['metric']))
    .map(r => ({
      id: r.id,
      metric: narrowMetric(r.metric),
      threshold: Number(r.threshold),
      channel: narrowChannel(r.channel),
      destination: r.destination,
      enabled: r.enabled,
    }))

  return NextResponse.json({ thresholds, source: 'supabase' })
}

// ── POST — create or trigger alerts ──────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>

  // Mode: 'save' → upsert threshold config; 'check' → evaluate and fire alerts
  const mode = body['mode'] ?? 'save'

  const db = createServerClient()
  if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })

  if (mode === 'save') {
    const t = body as {
      metric: AlertThreshold['metric']
      threshold: number
      channel: AlertThreshold['channel']
      destination: string
      enabled?: boolean
    }

    const { error } = await db.from('alert_thresholds').insert({
      metric: t.metric,
      threshold: t.threshold,
      channel: t.channel,
      destination: t.destination,
      enabled: t.enabled ?? true,
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (mode === 'check') {
    // Fetch all enabled thresholds and evaluate against current metrics
    const [thresholdsRes, agentsRes] = await Promise.all([
      db.from('alert_thresholds').select('*').eq('enabled', true),
      db.from('agents').select('cost_usd, error_count, status'),
    ])

    if (thresholdsRes.error || agentsRes.error) {
      return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
    }

    const totalCost  = agentsRes.data.reduce((s, a) => s + Number(a.cost_usd), 0)
    const errorCount = agentsRes.data.reduce((s, a) => s + (a.error_count ?? 0), 0)
    const agentCount = agentsRes.data.length
    const errorRate  = agentCount > 0 ? errorCount / agentCount : 0
    const downAgents = agentsRes.data.filter(a => a.status === 'error').length

    const fired: string[] = []

    for (const t of thresholdsRes.data ?? []) {
      if (!VALID_METRICS.has(t.metric as AlertThreshold['metric'])) continue
      const threshold: AlertThreshold = {
        id: t.id,
        metric: narrowMetric(t.metric),
        threshold: Number(t.threshold),
        channel: narrowChannel(t.channel),
        destination: t.destination,
        enabled: t.enabled,
      }

      let message: string | null = null

      if (t.metric === 'daily_cost' && totalCost > threshold.threshold) {
        message = `Total agent cost has reached $${totalCost.toFixed(2)}, exceeding your threshold of $${threshold.threshold}.`
      } else if (t.metric === 'error_rate' && errorRate > threshold.threshold) {
        message = `Agent error rate is ${(errorRate * 100).toFixed(1)}%, exceeding your threshold of ${(threshold.threshold * 100).toFixed(1)}%.`
      } else if (t.metric === 'agent_down' && downAgents >= threshold.threshold) {
        message = `${downAgents} agent(s) are in an error state, exceeding your threshold of ${threshold.threshold}.`
      }

      if (message) {
        await sendSlackOrEmail(threshold, message)
        fired.push(t.metric)
      }
    }

    return NextResponse.json({ checked: true, fired })
  }

  return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 })
}

// ── DELETE — remove a threshold ───────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const { id } = await req.json() as { id: string }
  const db = createServerClient()
  if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })

  const { error } = await db.from('alert_thresholds').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
