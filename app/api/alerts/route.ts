import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import type { AlertThreshold } from '@/lib/types'

export const runtime = 'nodejs'

// ── Alert helpers ─────────────────────────────────────────────────────────────

async function sendSlackAlert(webhookUrl: string, message: string): Promise<void> {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `🚨 *Nexus Alert*\n${message}` }),
  })
}

async function sendEmailAlert(to: string, subject: string, body: string): Promise<void> {
  // Requires RESEND_API_KEY — scaffold only, fill in when Resend is configured
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.warn('[alerts] RESEND_API_KEY not set — email alert skipped')
    return
  }
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from: 'Nexus Alerts <alerts@nexus.pinnacleadvisors.com>',
      to,
      subject,
      text: body,
    }),
  })
}

async function dispatchAlert(threshold: AlertThreshold, message: string): Promise<void> {
  if (threshold.channel === 'slack') {
    await sendSlackAlert(threshold.destination, message)
  } else {
    await sendEmailAlert(
      threshold.destination,
      `Nexus Alert: ${threshold.metric}`,
      message,
    )
  }
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

  const thresholds: AlertThreshold[] = (data ?? []).map(r => ({
    id: r.id,
    metric: r.metric,
    threshold: Number(r.threshold),
    channel: r.channel,
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
      const threshold: AlertThreshold = {
        id: t.id,
        metric: t.metric,
        threshold: Number(t.threshold),
        channel: t.channel,
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
        await dispatchAlert(threshold, message)
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
