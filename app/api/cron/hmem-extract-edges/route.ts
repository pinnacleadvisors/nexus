/**
 * POST /api/cron/hmem-extract-edges — LLM edge extraction for H-Mem.
 *
 * Walks atoms created in the last 24h, asks the active LLM "name the
 * causal/temporal/topical edges connecting these atoms", and writes
 * `mol_edge` rows with `source='llm'` and `confidence < 1.0`.
 *
 * Edges with confidence >= 0.7 are queryable immediately (the routing
 * layer treats them as canonical). Lower-confidence edges land in
 * mol_edge with source='llm' but the consumer surfaces them as
 * pending — see /api/teams/spawn route for the operator approval flow
 * (not wired in v4; surfaces as a `manual-task` in the chat UI when an
 * agent walks an edge below 0.7).
 *
 * Triggered by cron-job.org nightly. Hard token budget per cycle prevents
 * runaway cost — see assertUnderCostCap().
 *
 * Idempotency: extracted edges check (scope, src, dst, predicate, source='llm')
 * before insert so the cron is safe to re-run.
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createServerClient } from '@/lib/supabase'
import { getLlm } from '@/lib/llm/provider'
import { assertUnderCostCap } from '@/lib/cost-guard'

export const runtime     = 'nodejs'
export const maxDuration = 60

interface AtomRow { scope_id: string; slug: string; title: string; body_md: string; created_at: string }

interface ExtractedEdge {
  src_slug:   string
  dst_slug:   string
  predicate:  string
  confidence: number
}

const SYSTEM_PROMPT = `You extract structured edges between knowledge atoms.

Input: a list of atoms with slug + title + 1-sentence summary.
Output: a JSON array of edges. Each edge has:
  { "src_slug": "...", "dst_slug": "...", "predicate": "<verb>", "confidence": 0..1 }

Rules:
- predicate is ONE of: "caused", "preceded", "cancelled", "supersedes", "depends_on", "implements", "contradicts", "elaborates".
- confidence ∈ [0, 1]. Use ≥ 0.9 only when the link is explicitly stated. Use 0.5–0.7 for plausible inferences. Use < 0.5 for guesses (and prefer to OMIT — better to under-emit than over-emit noise).
- Only emit edges between atoms in the input list.
- Reply with ONLY the JSON array. No prose, no markdown fences.`

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 5, window: '1 m', prefix: 'cron:hmem-extract' })
  if (!rl.success) return rateLimitResponse(rl)

  const url    = new URL(req.url)
  const secret = url.searchParams.get('secret') ?? ''
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const cap = await assertUnderCostCap('system').catch(() => ({ ok: true } as { ok: boolean }))
  if (!cap.ok) {
    return NextResponse.json({ ok: false, error: 'cost cap exceeded; edge extraction skipped' }, { status: 200 })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'db unavailable' }, { status: 200 })

  const now   = new Date()
  const start = new Date(now.getTime() - 24 * 3600 * 1000)

  // Pull last-24h atoms — focus on incident / decision / infra-change
  // (high-signal kinds for edge extraction). General `fact` atoms make
  // the LLM noisy because they're more numerous + less structured.
  type Chain<T> = { gte: (c: string, v: string) => Chain<T>; lt: (c: string, v: string) => Chain<T>; order: (c: string, opts: { ascending: boolean }) => Chain<T>; limit: (n: number) => Promise<{ data: T[] | null; error?: { message: string } }> }
  const res = await (db.from('mol_atoms' as never) as unknown as { select: (c: string) => Chain<AtomRow> })
    .select('scope_id, slug, title, body_md, created_at')
    .gte('created_at', start.toISOString())
    .lt ('created_at', now.toISOString())
    .order('created_at', { ascending: true })
    .limit(500)

  if (res.error) {
    return NextResponse.json({ ok: false, error: res.error.message }, { status: 200 })
  }

  const atoms = res.data ?? []
  if (atoms.length === 0) {
    return NextResponse.json({ ok: true, atoms_scanned: 0, edges_extracted: 0, edges_inserted: 0, edges_skipped: 0 })
  }

  // Bucket by scope; one extraction call per scope.
  const byScope = new Map<string, AtomRow[]>()
  for (const a of atoms) {
    const arr = byScope.get(a.scope_id) ?? []
    arr.push(a); byScope.set(a.scope_id, arr)
  }

  let edges_extracted = 0, edges_inserted = 0, edges_skipped = 0
  const errors: string[] = []

  for (const [scope_id, list] of byScope.entries()) {
    try {
      const edges = await extractEdges(list)
      edges_extracted += edges.length
      for (const e of edges) {
        const srcId = `${scope_id}:${e.src_slug}`
        const dstId = `${scope_id}:${e.dst_slug}`
        // Dedup against existing edges.
        type ChainOne = { eq: (c: string, v: unknown) => ChainOne; limit: (n: number) => Promise<{ data: { id: string }[] | null }> }
        const existing = await (db.from('mol_edge' as never) as unknown as { select: (c: string) => ChainOne })
          .select('id')
          .eq('scope_id',  scope_id)
          .eq('src_id',    srcId)
          .eq('dst_id',    dstId)
          .eq('predicate', e.predicate)
          .eq('source',    'llm')
          .limit(1)
        if ((existing.data?.length ?? 0) > 0) { edges_skipped++; continue }

        const ins = await (db.from('mol_edge' as never) as unknown as {
          insert: (r: Record<string, unknown>) => Promise<{ error?: { message: string } }>
        }).insert({
          scope_id,
          src_kind:   'atom',
          src_id:     srcId,
          predicate:  e.predicate,
          dst_kind:   'atom',
          dst_id:     dstId,
          confidence: Math.max(0, Math.min(1, e.confidence)),
          source:     'llm',
        })
        if (ins.error) {
          errors.push(`${srcId}→${dstId}: ${ins.error.message}`)
        } else {
          edges_inserted++
        }
      }
    } catch (e) {
      errors.push(`${scope_id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return NextResponse.json({
    ok:              true,
    atoms_scanned:   atoms.length,
    scopes_scanned:  byScope.size,
    edges_extracted,
    edges_inserted,
    edges_skipped,
    errors,
  })
}

async function extractEdges(atoms: AtomRow[]): Promise<ExtractedEdge[]> {
  const compact = atoms.map(a => `- ${a.slug}: ${a.title} — ${(a.body_md ?? '').slice(0, 200)}`).join('\n')
  const res = await generateText({
    model:       getLlm(),
    system:      SYSTEM_PROMPT,
    prompt:      `Atoms in this batch:\n${compact}\n\nReturn JSON array of edges.`,
    temperature: 0,
  })
  const text = (res.text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  try {
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) return []
    const out: ExtractedEdge[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      if (typeof o.src_slug !== 'string' || typeof o.dst_slug !== 'string') continue
      if (typeof o.predicate !== 'string' || typeof o.confidence !== 'number') continue
      out.push({
        src_slug:   o.src_slug,
        dst_slug:   o.dst_slug,
        predicate:  o.predicate,
        confidence: o.confidence,
      })
    }
    return out
  } catch {
    return []
  }
}
