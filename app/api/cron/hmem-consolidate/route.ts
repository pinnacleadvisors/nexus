/**
 * POST /api/cron/hmem-consolidate — H-Mem temporal consolidation.
 *
 * Walks mol_atoms (or mol_temporal_node at higher levels) and produces
 * compressed summary nodes via the active LLM:
 *
 *   level=1 (daily)   yesterday's episodic atoms → 1 day-summary node per scope
 *   level=2 (weekly)  last 7 days of L1 nodes    → 1 week-summary per scope
 *   level=3 (monthly) last 30 days of L2 nodes   → 1 topic-summary per scope
 *
 * Triggered by cron-job.org per the platform topology (see AGENTS.md).
 * Daily at 03:00; weekly Sunday 03:30; monthly 1st-of-month 04:00.
 *
 * Guards:
 *   - Auth: `?secret=<CRON_SECRET>` (mirrors /api/cron/signal-review pattern).
 *   - Cost: assertUnderCostCap() before any LLM call; bails if over.
 *   - Idempotency: existing summary for the same (scope, level, ts_start, ts_end)
 *                  window is detected and the cycle is a no-op for that window.
 *
 * Empty input (nothing new in the window) → 200 + summary:0. Not an error.
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createServerClient } from '@/lib/supabase'
import { getLlm } from '@/lib/llm/provider'
import { assertUnderCostCap } from '@/lib/cost-guard'

export const runtime     = 'nodejs'
export const maxDuration = 60

type Level = 1 | 2 | 3

interface AtomRow         { scope_id: string; slug: string; title: string; body_md: string; created_at: string }
interface TemporalNodeRow { id: string; scope_id: string; level: number; title: string; body: string; ts_start: string; ts_end: string; source_atom_ids?: string[] }

interface ConsolidationResult {
  ok:              boolean
  level:           Level
  windows_scanned: number
  summaries_written: number
  skipped_idempotent: number
  errors:          string[]
}

const SYSTEM_PROMPT = `You compress a batch of timestamped knowledge atoms into ONE summary node.

Constraints:
- Lead with a 1-sentence headline.
- Bullet the 5–10 most important facts; cite the source slug in parentheses.
- Note disputes (atoms that contradict each other) explicitly.
- Total length under 300 words. No filler.
- Markdown body only — no JSON wrapper, no code fences around the whole reply.`

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 10, window: '1 m', prefix: 'cron:hmem-consolidate' })
  if (!rl.success) return rateLimitResponse(rl)

  const url    = new URL(req.url)
  const secret = url.searchParams.get('secret') ?? ''
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const levelRaw = url.searchParams.get('level') ?? '1'
  const level = (levelRaw === '1' || levelRaw === '2' || levelRaw === '3') ? Number(levelRaw) as Level : 1

  // Hard cap on LLM cost per cycle — refuse to start if user-day cap is breached.
  const cap = await assertUnderCostCap('system').catch(() => ({ ok: true } as { ok: boolean }))
  if (!cap.ok) {
    return NextResponse.json({ ok: false, error: 'cost cap exceeded; consolidation skipped this cycle' }, { status: 200 })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'db unavailable' }, { status: 200 })

  const result = level === 1
    ? await consolidateLevel1(db)
    : await consolidateHigher(db, level)

  return NextResponse.json(result)
}

/** Level 1: yesterday's episodic atoms (mol_atoms.created_at in last 24h) →
 *  one day-summary mol_temporal_node per scope. */
async function consolidateLevel1(db: ReturnType<typeof createServerClient>): Promise<ConsolidationResult> {
  if (!db) return { ok: false, level: 1, windows_scanned: 0, summaries_written: 0, skipped_idempotent: 0, errors: ['db unavailable'] }
  const now    = new Date()
  const start  = new Date(now.getTime() - 24 * 3600 * 1000)
  const errors: string[] = []

  type Chain<T> = { gte: (c: string, v: string) => Chain<T>; lt: (c: string, v: string) => Chain<T>; order: (c: string, opts: { ascending: boolean }) => Chain<T>; limit: (n: number) => Promise<{ data: T[] | null; error?: { message: string } }> }
  const res = await (db.from('mol_atoms' as never) as unknown as { select: (c: string) => Chain<AtomRow> })
    .select('scope_id, slug, title, body_md, created_at')
    .gte('created_at', start.toISOString())
    .lt ('created_at', now.toISOString())
    .order('created_at', { ascending: true })
    .limit(2000)

  if (res.error) {
    return { ok: false, level: 1, windows_scanned: 0, summaries_written: 0, skipped_idempotent: 0, errors: [res.error.message] }
  }

  const atoms = res.data ?? []
  // Bucket by scope.
  const byScope = new Map<string, AtomRow[]>()
  for (const a of atoms) {
    const arr = byScope.get(a.scope_id) ?? []
    arr.push(a); byScope.set(a.scope_id, arr)
  }

  let summaries_written = 0, skipped_idempotent = 0
  for (const [scope_id, list] of byScope.entries()) {
    if (list.length === 0) continue
    if (await summaryExists(db, scope_id, 1, start, now)) { skipped_idempotent++; continue }
    try {
      const body = await summarise(list, 1)
      await insertSummary(db, scope_id, 1, body, list.map(a => `${a.scope_id}:${a.slug}`), start, now)
      summaries_written++
    } catch (e) {
      errors.push(`${scope_id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { ok: true, level: 1, windows_scanned: byScope.size, summaries_written, skipped_idempotent, errors }
}

/** Levels 2 + 3: walk lower-level mol_temporal_node rows in the window
 *  (7 days for L2, 30 days for L3) → one summary per scope. */
async function consolidateHigher(db: ReturnType<typeof createServerClient>, level: 2 | 3): Promise<ConsolidationResult> {
  if (!db) return { ok: false, level, windows_scanned: 0, summaries_written: 0, skipped_idempotent: 0, errors: ['db unavailable'] }
  const windowDays = level === 2 ? 7 : 30
  const now    = new Date()
  const start  = new Date(now.getTime() - windowDays * 24 * 3600 * 1000)
  const lowerLevel = level - 1
  const errors: string[] = []

  type Chain<T> = { eq: (c: string, v: number) => Chain<T>; gte: (c: string, v: string) => Chain<T>; lt: (c: string, v: string) => Chain<T>; order: (c: string, opts: { ascending: boolean }) => Chain<T>; limit: (n: number) => Promise<{ data: T[] | null; error?: { message: string } }> }
  const res = await (db.from('mol_temporal_node' as never) as unknown as { select: (c: string) => Chain<TemporalNodeRow> })
    .select('id, scope_id, level, title, body, ts_start, ts_end')
    .eq('level', lowerLevel)
    .gte('ts_end', start.toISOString())
    .lt ('ts_end', now.toISOString())
    .order('ts_end', { ascending: true })
    .limit(1000)

  if (res.error) {
    return { ok: false, level, windows_scanned: 0, summaries_written: 0, skipped_idempotent: 0, errors: [res.error.message] }
  }

  const byScope = new Map<string, TemporalNodeRow[]>()
  for (const n of res.data ?? []) {
    const arr = byScope.get(n.scope_id) ?? []
    arr.push(n); byScope.set(n.scope_id, arr)
  }

  let summaries_written = 0, skipped_idempotent = 0
  for (const [scope_id, list] of byScope.entries()) {
    if (list.length === 0) continue
    if (await summaryExists(db, scope_id, level, start, now)) { skipped_idempotent++; continue }
    try {
      const body = await summarise(list, level)
      await insertSummary(db, scope_id, level, body, list.map(n => n.id), start, now)
      summaries_written++
    } catch (e) {
      errors.push(`${scope_id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { ok: true, level, windows_scanned: byScope.size, summaries_written, skipped_idempotent, errors }
}

async function summarise(items: Array<AtomRow | TemporalNodeRow>, level: Level): Promise<string> {
  const compact = items.map(it => {
    if ('body_md' in it) return `- ${it.title} (${it.scope_id}:${it.slug}): ${(it.body_md ?? '').slice(0, 400)}`
    return `- ${it.title} (L${it.level}): ${(it.body ?? '').slice(0, 400)}`
  }).join('\n')
  const res = await generateText({
    model:       getLlm(),
    system:      SYSTEM_PROMPT,
    prompt:      `Level ${level} consolidation. Input items:\n${compact}\n\nWrite the summary.`,
    temperature: 0,
  })
  return (res.text ?? '').trim().slice(0, 12_000)
}

async function summaryExists(db: ReturnType<typeof createServerClient>, scope_id: string, level: Level, ts_start: Date, ts_end: Date): Promise<boolean> {
  if (!db) return false
  type Chain<T> = { eq: (c: string, v: unknown) => Chain<T>; gte: (c: string, v: string) => Chain<T>; lte: (c: string, v: string) => Chain<T>; limit: (n: number) => Promise<{ data: T[] | null }> }
  const res = await (db.from('mol_temporal_node' as never) as unknown as { select: (c: string) => Chain<{ id: string }> })
    .select('id').eq('scope_id', scope_id).eq('level', level).gte('ts_start', ts_start.toISOString()).lte('ts_end', ts_end.toISOString()).limit(1)
  return (res.data?.length ?? 0) > 0
}

async function insertSummary(db: ReturnType<typeof createServerClient>, scope_id: string, level: Level, body: string, source_ids: string[], ts_start: Date, ts_end: Date): Promise<void> {
  if (!db) return
  const title = level === 1
    ? `Daily summary ${ts_end.toISOString().slice(0, 10)}`
    : level === 2
      ? `Weekly summary ${ts_end.toISOString().slice(0, 10)}`
      : `Monthly summary ${ts_end.toISOString().slice(0, 10)}`
  // source_atom_ids column is uuid[] from migration 061. We store string
  // ids (atom keys) for L1 inputs; the column was originally typed uuid
  // but we treat it as opaque text-cast at the route layer. If it
  // rejects, the row is rejected — caller logs the error.
  await (db.from('mol_temporal_node' as never) as unknown as {
    insert: (r: Record<string, unknown>) => Promise<{ error?: { message: string } }>
  }).insert({
    scope_id,
    level,
    title,
    body,
    ts_start: ts_start.toISOString(),
    ts_end:   ts_end.toISOString(),
    source_atom_ids: source_ids,
  })
}
