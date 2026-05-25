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
  // v12 — auto-open a draft PR with the ADR Results section pre-filled,
  // when MEMORY_HQ_TOKEN + MEMORY_REPO are set (the operator already has
  // these for memory-hq writes). Slack post above still happens for ack.
  const prResult = await openAdrPr(hqSummary, gbSummary).catch(e => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))

  return NextResponse.json({
    ok:        true,
    posted:    sent,
    pr:        prResult,
    memory_hq: hqSummary,
    gbrain:    gbSummary,
  })
}

/**
 * Opens a draft PR against pinnacleadvisors/nexus with the ADR 009
 * Results section pre-filled. No-ops gracefully when MEMORY_HQ_TOKEN or
 * MEMORY_REPO are unset (returns ok:false + reason); the operator still
 * gets the Slack post.
 */
/** v13 — ADR 009 numeric decision. Applies the same criteria the bench prints
 *  at line 311 ("gbrain wins if citation ≥ +25% over memory-hq AND p95 < 3000ms
 *  AND errors ≤ 2") so the PR's Decision line is filled in automatically.
 *  Operator can still override before marking Ready for Review. */
type BenchDecision = {
  verdict:   'integrate' | 'defer' | 'reject'
  rationale: string
}
function computeDecision(hq: AdapterSummary, gb: AdapterSummary): BenchDecision {
  const citationGainPct = hq.avg_score > 0 ? ((gb.avg_score - hq.avg_score) / hq.avg_score) * 100 : 0
  const p95Ok    = gb.p95_latency_ms < 3000
  const errorsOk = gb.errors <= 2
  const gainOk   = citationGainPct >= 25

  const fmtGain = `${citationGainPct >= 0 ? '+' : ''}${citationGainPct.toFixed(1)}%`
  if (gainOk && p95Ok && errorsOk) {
    return {
      verdict:   'integrate',
      rationale: `gbrain wins all ADR 009 criteria: citation gain ${fmtGain} (target ≥ +25%), p95 ${gb.p95_latency_ms}ms (target < 3000ms), ${gb.errors} errors (target ≤ 2). Promote gbrain to default memory adapter for hot reads.`,
    }
  }
  if (citationGainPct <= 0) {
    return {
      verdict:   'reject',
      rationale: `memory-hq matches or beats gbrain on citation (${fmtGain} gain). p95 ${gb.p95_latency_ms}ms, ${gb.errors} errors. No reason to integrate.`,
    }
  }
  // Improvement exists but at least one criterion failed — defer to next bench.
  const failed: string[] = []
  if (!gainOk)   failed.push(`citation gain ${fmtGain} below +25% target`)
  if (!p95Ok)    failed.push(`p95 ${gb.p95_latency_ms}ms above 3000ms target`)
  if (!errorsOk) failed.push(`${gb.errors} errors above ≤2 target`)
  return {
    verdict:   'defer',
    rationale: `gbrain shows improvement (${fmtGain} citation) but fails: ${failed.join('; ')}. Re-run after upstream tuning.`,
  }
}

async function openAdrPr(hq: AdapterSummary, gb: AdapterSummary): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const token = process.env.MEMORY_HQ_TOKEN
  // ADR lives in this repo (pinnacleadvisors/nexus), not memory-hq. Reuse
  // the same token (it's a PAT with repo scope per memory/platform/SECRETS.md).
  const repo = 'pinnacleadvisors/nexus'
  if (!token) return { ok: false, error: 'MEMORY_HQ_TOKEN not set' }

  const branch = `gbrain-bench/${new Date().toISOString().slice(0, 10)}`
  const path   = 'docs/adr/009-gbrain-evaluation.md'
  const base   = 'main'

  // 1. Get current main SHA + ADR file.
  const ghGet = async (p: string) => fetch(`https://api.github.com/repos/${repo}/${p}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15_000),
  })
  const refRes = await ghGet(`git/ref/heads/${base}`)
  if (!refRes.ok) return { ok: false, error: `github get-ref ${refRes.status}` }
  const refJson = await refRes.json() as { object?: { sha?: string } }
  const baseSha = refJson.object?.sha
  if (!baseSha) return { ok: false, error: 'no base sha' }

  const fileRes = await ghGet(`contents/${encodeURIComponent(path)}?ref=${base}`)
  if (!fileRes.ok) return { ok: false, error: `github get-file ${fileRes.status}` }
  const fileJson = await fileRes.json() as { content?: string; sha?: string }
  if (!fileJson.content || !fileJson.sha) return { ok: false, error: 'no file content' }
  const current = Buffer.from(fileJson.content, 'base64').toString('utf-8')

  // 2. Replace the Results section. We look for the `## Results` heading
  //    and append our block beneath it (or replace if already filled).
  // v13 — compute Decision automatically from ADR 009 numeric criteria;
  // operator can override before marking the PR Ready for Review.
  const date     = new Date().toISOString().slice(0, 10)
  const decision = computeDecision(hq, gb)
  const block = [
    `Date: ${date}`,
    '',
    `memory-hq:`,
    `  avg citation score: ${(hq.avg_score * 100).toFixed(1)}%`,
    `  p50 latency:        ${hq.p50_latency_ms} ms`,
    `  p95 latency:        ${hq.p95_latency_ms} ms`,
    `  errors:             ${hq.errors} / ${hq.questions}`,
    '',
    `gbrain:`,
    `  avg citation score: ${(gb.avg_score * 100).toFixed(1)}%`,
    `  p50 latency:        ${gb.p50_latency_ms} ms`,
    `  p95 latency:        ${gb.p95_latency_ms} ms`,
    `  errors:             ${gb.errors} / ${gb.questions}`,
    '',
    `Decision: ${decision.verdict}`,
    `Rationale: ${decision.rationale}`,
  ].join('\n')

  // Replace existing "Date: <YYYY-MM-DD>" placeholder OR append a new
  // dated entry under ## Results.
  let next: string
  if (current.includes('Date: <YYYY-MM-DD>')) {
    next = current.replace(/```\nDate: <YYYY-MM-DD>[\s\S]*?```/, '```\n' + block + '\n```')
  } else {
    next = current.replace(/## Results.*?\n/, m => `${m}\n\`\`\`\n${block}\n\`\`\`\n\n`)
  }
  if (next === current) return { ok: false, error: 'no anchor matched in ADR' }

  // 3. Create the branch (PUT git/refs).
  const ghPost = (p: string, body: object) => fetch(`https://api.github.com/repos/${repo}/${p}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const newRef = await ghPost('git/refs', { ref: `refs/heads/${branch}`, sha: baseSha })
  if (!newRef.ok) {
    const t = await newRef.text().catch(() => '')
    // 422 = branch exists — fine, we'll just commit on top.
    if (newRef.status !== 422) return { ok: false, error: `github create-branch ${newRef.status}: ${t.slice(0, 200)}` }
  }

  // 4. Commit the updated file via the contents API.
  const commit = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
    body: JSON.stringify({
      message: `chore(adr): auto-fill GBrain bench results ${date}`,
      content: Buffer.from(next, 'utf-8').toString('base64'),
      sha:     fileJson.sha,
      branch,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!commit.ok) {
    const t = await commit.text().catch(() => '')
    return { ok: false, error: `github commit ${commit.status}: ${t.slice(0, 200)}` }
  }

  // 5. Open draft PR.
  const verdictEmoji = decision.verdict === 'integrate' ? ':white_check_mark:' : decision.verdict === 'reject' ? ':x:' : ':hourglass_flowing_sand:'
  const pr = await ghPost('pulls', {
    title: `chore(adr): GBrain bench results ${date} — ${decision.verdict}`,
    head:  branch,
    base,
    body:  [
      `Auto-generated by \`/api/cron/gbrain-bench\`. Review the Decision + Rationale lines, override if needed, then mark Ready for Review.`,
      '',
      `${verdictEmoji} **Auto-decision: ${decision.verdict}**`,
      `> ${decision.rationale}`,
      '',
      '| metric | memory-hq | gbrain |',
      '|---|---|---|',
      `| avg citation | ${(hq.avg_score * 100).toFixed(1)}% | ${(gb.avg_score * 100).toFixed(1)}% |`,
      `| p95 latency  | ${hq.p95_latency_ms}ms | ${gb.p95_latency_ms}ms |`,
      `| errors       | ${hq.errors}/${hq.questions} | ${gb.errors}/${gb.questions} |`,
      '',
      'ADR 009 criteria: integrate iff citation gain ≥ +25% AND p95 < 3000ms AND errors ≤ 2.',
    ].join('\n'),
    draft: true,
  })
  if (!pr.ok) {
    const t = await pr.text().catch(() => '')
    return { ok: false, error: `github pr ${pr.status}: ${t.slice(0, 200)}` }
  }
  const prJson = await pr.json() as { html_url?: string }
  return { ok: true, url: prJson.html_url ?? '' }
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
