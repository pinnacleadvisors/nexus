#!/usr/bin/env node
/**
 * scripts/eval-memory.mjs — run the 50-question benchmark against a memory adapter.
 *
 * Usage:
 *   node scripts/eval-memory.mjs memory-hq            # against the canonical
 *   node scripts/eval-memory.mjs gbrain               # against GBrain (requires GBRAIN_BASE_URL)
 *   node scripts/eval-memory.mjs memory-hq --json     # JSON output, machine-readable
 *
 * Output:
 *   - Pass/fail per question (citation check: does the answer mention any expected_atoms slug?)
 *   - Aggregate F1-ish score
 *   - Per-adapter latency p50 / p95
 *
 * v1 grading is a substring-citation check. It's intentionally simple — the
 * goal is "does the adapter surface the right atoms in its answer?", not
 * full NLP grading. Real NLP grading lands when the benchmark proves
 * value.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BENCH_PATH = resolve(process.cwd(), 'tests', 'memory', 'multi-hop-questions.json')

const args = process.argv.slice(2)
const ADAPTER = args[0]
const JSON_OUT = args.includes('--json')

if (!ADAPTER || (ADAPTER !== 'memory-hq' && ADAPTER !== 'gbrain')) {
  console.error('usage: node scripts/eval-memory.mjs <memory-hq|gbrain> [--json]')
  process.exit(2)
}

const NEXUS_BASE = process.env.NEXUS_BASE_URL ?? 'http://localhost:3000'
const HQ_TOKEN   = process.env.MEMORY_HQ_TOKEN ?? ''
const GBRAIN_BASE = process.env.GBRAIN_BASE_URL ?? ''
const GBRAIN_KEY  = process.env.GBRAIN_API_KEY ?? ''

if (ADAPTER === 'gbrain' && !GBRAIN_BASE) {
  console.error('GBrain selected but GBRAIN_BASE_URL is not set.')
  process.exit(3)
}

async function query(question) {
  if (ADAPTER === 'memory-hq') {
    const url = `${NEXUS_BASE}/api/memory/query?q=${encodeURIComponent(question)}&limit=10`
    const res = await fetch(url, { headers: HQ_TOKEN ? { authorization: `Bearer ${HQ_TOKEN}` } : {}, signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return { text: '', latency_ms: 0, error: `HTTP ${res.status}` }
    const j = await res.json()
    // Concatenate atom titles + bodies — the citation check looks for slugs in there.
    const text = (j.results ?? []).map(r => `${r.slug ?? ''} ${r.title ?? ''} ${r.body ?? ''}`).join(' ')
    return { text, latency_ms: j.took_ms ?? 0 }
  }
  // gbrain
  const url = `${GBRAIN_BASE}/query`
  const t0 = Date.now()
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'content-type': 'application/json', ...(GBRAIN_KEY ? { authorization: `Bearer ${GBRAIN_KEY}` } : {}) },
    body:    JSON.stringify({ question, k: 10 }),
    signal:  AbortSignal.timeout(20_000),
  })
  const dt = Date.now() - t0
  if (!res.ok) return { text: '', latency_ms: dt, error: `HTTP ${res.status}` }
  const j = await res.json()
  // GBrain response shape is TBD per Phase 1 recon. v1 assumes the answer
  // is in `j.answer` or `j.text` — the recon doc will pin the contract.
  return { text: String(j.answer ?? j.text ?? JSON.stringify(j)), latency_ms: dt }
}

function gradeCitation(answerText, expectedAtoms) {
  const lower = answerText.toLowerCase()
  let hits = 0
  for (const slug of expectedAtoms) {
    if (lower.includes(slug.toLowerCase())) hits++
  }
  return { hits, total: expectedAtoms.length, score: hits / expectedAtoms.length }
}

async function main() {
  const bench = JSON.parse(await readFile(BENCH_PATH, 'utf-8'))
  const results = []
  for (const q of bench.questions) {
    process.stderr.write(`q${String(q.id).padStart(2, ' ')}… `)
    let res
    try {
      res = await query(q.q)
    } catch (e) {
      res = { text: '', latency_ms: 0, error: e.message }
    }
    const grade = gradeCitation(res.text, q.expected_atoms)
    results.push({ id: q.id, question: q.q, latency_ms: res.latency_ms, error: res.error, hits: grade.hits, total: grade.total, score: grade.score })
    process.stderr.write(`${grade.hits}/${grade.total}\n`)
  }
  const total_questions = results.length
  const avg_score    = results.reduce((s, r) => s + r.score, 0) / total_questions
  const latencies    = results.map(r => r.latency_ms).filter(n => n > 0).sort((a, b) => a - b)
  const p50          = latencies[Math.floor(latencies.length / 2)] ?? 0
  const p95          = latencies[Math.floor(latencies.length * 0.95)] ?? 0
  const errors       = results.filter(r => r.error).length

  const summary = { adapter: ADAPTER, total_questions, avg_score, p50_latency_ms: p50, p95_latency_ms: p95, errors }
  if (JSON_OUT) {
    console.log(JSON.stringify({ summary, results }, null, 2))
  } else {
    console.log('')
    console.log(`adapter:           ${summary.adapter}`)
    console.log(`questions:         ${summary.total_questions}`)
    console.log(`avg citation score: ${(summary.avg_score * 100).toFixed(1)}%`)
    console.log(`p50 latency:       ${summary.p50_latency_ms} ms`)
    console.log(`p95 latency:       ${summary.p95_latency_ms} ms`)
    console.log(`errors:            ${summary.errors}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
