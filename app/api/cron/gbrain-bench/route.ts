/**
 * POST /api/cron/gbrain-bench — automated GBrain vs memory-hq benchmark.
 *
 * Runs the 50-question multi-hop bench against BOTH adapters when
 * GBRAIN_BASE_URL is set, formats a markdown report, posts to Slack.
 * Operator can paste into ADR 009 (or wire a follow-up PR-opener in v12).
 *
 * Schedule: weekly (registered by sync-crons-hmem.mjs at Sunday 05:00 UTC).
 * No-op when GBRAIN_BASE_URL is unset (returns ok:true + reason).
 *
 * This is the "delegate to qa-tester" answer for the GBrain ADR — qa-runner
 * is Playwright-focused (wrong fit). The bench runs entirely server-side
 * via the same API surface the operator's --update-adr CLI uses.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { getSlackConfig, postSlackNotification } from '@/lib/slack/client'

export const runtime     = 'nodejs'
export const maxDuration = 60

interface BenchQuestion {
  id:              number
  q:               string
  expected_atoms:  string[]
}

interface BenchResult {
  id:         number
  hits:       number
  total:      number
  score:      number
  latency_ms: number
  error?:     string
}

interface AdapterSummary {
  adapter:           'memory-hq' | 'gbrain'
  questions:         number
  avg_score:         number
  p50_latency_ms:    number
  p95_latency_ms:    number
  errors:            number
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 5, window: '1 m', prefix: 'cron:gbrain-bench' })
  if (!rl.success) return rateLimitResponse(rl)

  const url    = new URL(req.url)
  const secret = url.searchParams.get('secret') ?? ''
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  // No-op when GBrain isn't deployed yet. The route still pings ok:true so
  // /cron-health shows green; the message tells the operator why nothing
  // happened.
  if (!process.env.GBRAIN_BASE_URL) {
    return NextResponse.json({
      ok:      true,
      skipped: true,
      reason:  'gbrain_not_configured',
      hint:    'Set GBRAIN_BASE_URL via scripts/install-gbrain-sandbox.mjs to enable weekly benchmarking.',
    })
  }

  let questions: BenchQuestion[]
  try {
    const path = resolve(process.cwd(), 'tests', 'memory', 'multi-hop-questions.json')
    const raw  = await readFile(path, 'utf-8')
    const data = JSON.parse(raw) as { questions: BenchQuestion[] }
    questions  = data.questions ?? []
  } catch (e) {
    return NextResponse.json({
      ok:    false,
      error: 'bench_load_failed',
      detail: e instanceof Error ? e.message : String(e),
    }, { status: 200 })
  }

  const [hqSummary, hqResults]   = await runAdapter('memory-hq', questions)
  const [gbSummary, gbResults]   = await runAdapter('gbrain',    questions)

  const markdown = renderReport(hqSummary, hqResults, gbSummary, gbResults)
  const sent = await postReport(markdown)

  return NextResponse.json({
    ok:        true,
    posted:    sent,
    memory_hq: hqSummary,
    gbrain:    gbSummary,
  })
}

/** Run one adapter against all questions. Returns the summary + per-question
 *  results so the markdown formatter has everything it needs. */
async function runAdapter(adapter: 'memory-hq' | 'gbrain', questions: BenchQuestion[]): Promise<[AdapterSummary, BenchResult[]]> {
  const results: BenchResult[] = []
  for (const q of questions) {
    const r = await queryOne(adapter, q.q)
    const grade = gradeCitation(r.text, q.expected_atoms)
    results.push({
      id:         q.id,
      hits:       grade.hits,
      total:      grade.total,
      score:      grade.score,
      latency_ms: r.latency_ms,
      error:      r.error,
    })
  }
  const total      = results.length
  const avgScore   = total > 0 ? results.reduce((s, r) => s + r.score, 0) / total : 0
  const latencies  = results.map(r => r.latency_ms).filter(n => n > 0).sort((a, b) => a - b)
  const p50        = latencies[Math.floor(latencies.length / 2)]      ?? 0
  const p95        = latencies[Math.floor(latencies.length * 0.95)]   ?? 0
  const errors     = results.filter(r => r.error).length
  return [
    { adapter, questions: total, avg_score: avgScore, p50_latency_ms: p50, p95_latency_ms: p95, errors },
    results,
  ]
}

async function queryOne(adapter: 'memory-hq' | 'gbrain', question: string): Promise<{ text: string; latency_ms: number; error?: string }> {
  if (adapter === 'memory-hq') {
    const base = (process.env.NEXUS_BASE_URL ?? '').replace(/\/$/, '')
    const headers: Record<string, string> = {}
    if (process.env.MEMORY_HQ_TOKEN) headers.authorization = `Bearer ${process.env.MEMORY_HQ_TOKEN}`
    const t0 = Date.now()
    try {
      const res = await fetch(`${base}/api/memory/query?q=${encodeURIComponent(question)}&limit=10`, {
        headers, signal: AbortSignal.timeout(20_000),
      })
      const dt = Date.now() - t0
      if (!res.ok) return { text: '', latency_ms: dt, error: `HTTP ${res.status}` }
      const j = await res.json() as { results?: Array<{ slug?: string; title?: string; body?: string }> }
      const text = (j.results ?? []).map(r => `${r.slug ?? ''} ${r.title ?? ''} ${r.body ?? ''}`).join(' ')
      return { text, latency_ms: dt }
    } catch (e) {
      return { text: '', latency_ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) }
    }
  }
  // gbrain
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (process.env.GBRAIN_API_KEY) headers.authorization = `Bearer ${process.env.GBRAIN_API_KEY}`
  const t0 = Date.now()
  try {
    const res = await fetch(`${process.env.GBRAIN_BASE_URL}/query`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({ question, k: 10 }),
      signal:  AbortSignal.timeout(20_000),
    })
    const dt = Date.now() - t0
    if (!res.ok) return { text: '', latency_ms: dt, error: `HTTP ${res.status}` }
    const j = await res.json()
    return { text: String(j.answer ?? j.text ?? JSON.stringify(j)), latency_ms: dt }
  } catch (e) {
    return { text: '', latency_ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) }
  }
}

function gradeCitation(answerText: string, expectedAtoms: string[]): { hits: number; total: number; score: number } {
  const lower = answerText.toLowerCase()
  let hits = 0
  for (const slug of expectedAtoms) {
    if (lower.includes(slug.toLowerCase())) hits++
  }
  const total = expectedAtoms.length
  return { hits, total, score: total > 0 ? hits / total : 0 }
}

function renderReport(
  hqSummary: AdapterSummary, _hqResults: BenchResult[],
  gbSummary: AdapterSummary, _gbResults: BenchResult[],
): string {
  const date = new Date().toISOString().slice(0, 10)
  const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`
  return [
    `:bar_chart: *Weekly GBrain vs memory-hq bench* — ${date}`,
    '',
    '```',
    `              memory-hq    gbrain`,
    `  citation:   ${fmtPct(hqSummary.avg_score).padEnd(10)} ${fmtPct(gbSummary.avg_score)}`,
    `  p50 (ms):   ${String(hqSummary.p50_latency_ms).padEnd(10)} ${gbSummary.p50_latency_ms}`,
    `  p95 (ms):   ${String(hqSummary.p95_latency_ms).padEnd(10)} ${gbSummary.p95_latency_ms}`,
    `  errors:     ${String(hqSummary.errors).padEnd(10)} ${gbSummary.errors} / ${gbSummary.questions}`,
    '```',
    '',
    `Decision criteria (ADR 009): gbrain wins if citation ≥ +25% over memory-hq AND p95 < 3000ms AND errors ≤ 2.`,
    `Paste into docs/adr/009-gbrain-evaluation.md Results section to commit.`,
  ].join('\n')
}

async function postReport(text: string): Promise<boolean> {
  const operatorId = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)[0] ?? ''
  const cfg = operatorId
    ? await getSlackConfig(operatorId)
    : { webhookUrl: process.env.NEXUS_SLACK_WEBHOOK_URL ?? undefined }
  if (!cfg.webhookUrl) return false
  return await postSlackNotification(cfg, { text })
}
