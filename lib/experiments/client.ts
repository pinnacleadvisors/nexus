/**
 * lib/experiments/client.ts — C5
 *
 * CRUD + statistical decision for the A/B experiment harness. A two-proportion
 * z-test runs on every sample update; when p < 0.05 we lock the winner in and
 * file a workflow_feedback row for the losing variant so the optimiser can
 * revise the producing agent.
 */

import { createServerClient } from '@/lib/supabase'
import type {
  CreateExperimentInput,
  Experiment,
  ExperimentStatus,
  ExperimentVariant,
  ExperimentWinner,
  SampleInput,
} from './types'

const MIN_SAMPLES_PER_ARM = 30
const CONFIDENCE_TARGET   = 0.95  // z ≈ 1.96

interface ExperimentRow {
  id:           string
  run_id:       string | null
  user_id:      string
  hypothesis:   string | null
  variant_a:    ExperimentVariant
  variant_b:    ExperimentVariant
  samples_a:    number
  samples_b:    number
  successes_a:  number
  successes_b:  number
  winner:       ExperimentWinner | null
  confidence:   number | null
  status:       ExperimentStatus
  created_at:   string
  updated_at:   string
  decided_at:   string | null
}

function rowToExperiment(r: ExperimentRow): Experiment {
  return {
    id:          r.id,
    runId:       r.run_id ?? undefined,
    userId:      r.user_id,
    hypothesis:  r.hypothesis ?? undefined,
    variantA:    r.variant_a,
    variantB:    r.variant_b,
    samplesA:    r.samples_a,
    samplesB:    r.samples_b,
    successesA:  r.successes_a,
    successesB:  r.successes_b,
    winner:      r.winner ?? undefined,
    confidence:  r.confidence ?? undefined,
    status:      r.status,
    createdAt:   r.created_at,
    updatedAt:   r.updated_at,
    decidedAt:   r.decided_at ?? undefined,
  }
}

// ── Two-proportion z-test ──────────────────────────────────────────────────
export interface ZTestResult {
  winner:     ExperimentWinner   // 'a' | 'b' | 'tie'
  confidence: number              // 1 - 2·Φ(-|z|)
  rateA:      number
  rateB:      number
}

export function twoProportionZTest(
  successesA: number, samplesA: number,
  successesB: number, samplesB: number,
): ZTestResult {
  const rateA = samplesA > 0 ? successesA / samplesA : 0
  const rateB = samplesB > 0 ? successesB / samplesB : 0
  if (samplesA < MIN_SAMPLES_PER_ARM || samplesB < MIN_SAMPLES_PER_ARM) {
    return { winner: 'tie', confidence: 0, rateA, rateB }
  }
  const pooled = (successesA + successesB) / (samplesA + samplesB)
  const se     = Math.sqrt(pooled * (1 - pooled) * (1 / samplesA + 1 / samplesB))
  if (se === 0) return { winner: 'tie', confidence: 0, rateA, rateB }
  const z      = (rateA - rateB) / se
  // Two-sided p-value via normal CDF approximation
  const conf   = 1 - 2 * (1 - standardNormalCdf(Math.abs(z)))
  if (conf < CONFIDENCE_TARGET) return { winner: 'tie', confidence: conf, rateA, rateB }
  return { winner: z > 0 ? 'a' : 'b', confidence: conf, rateA, rateB }
}

/** Abramowitz-Stegun approximation of the standard-normal CDF (4.2.16). */
function standardNormalCdf(x: number): number {
  const t  = 1 / (1 + 0.2316419 * x)
  const pdf = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI)
  const poly = ((((1.330274429 * t - 1.821255978) * t + 1.781477937) * t - 0.356563782) * t + 0.319381530) * t
  return 1 - pdf * poly
}

// ── CRUD ────────────────────────────────────────────────────────────────────
export async function createExperiment(userId: string, input: CreateExperimentInput): Promise<Experiment | null> {
  const db = createServerClient()
  if (!db) return null
  const { data, error } = await (db.from('experiments' as never) as unknown as {
    insert: (rec: unknown) => { select: () => { single: () => Promise<{ data: ExperimentRow | null; error: { message: string } | null }> } }
  }).insert({
    user_id:    userId,
    run_id:     input.runId ?? null,
    hypothesis: input.hypothesis ?? null,
    variant_a:  input.variantA,
    variant_b:  input.variantB,
  }).select().single()
  if (error || !data) return null
  return rowToExperiment(data)
}

export async function getExperiment(id: string): Promise<Experiment | null> {
  const db = createServerClient()
  if (!db) return null
  const { data } = await (db.from('experiments' as never) as unknown as {
    select: (cols: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: ExperimentRow | null }> } }
  }).select('*').eq('id', id).maybeSingle()
  return data ? rowToExperiment(data) : null
}

export async function listExperiments(userId: string, opts: { runId?: string; status?: ExperimentStatus } = {}): Promise<Experiment[]> {
  const db = createServerClient()
  if (!db) return []
  type Chain = {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => Promise<{ data: ExperimentRow[] | null }> }
        order: (c: string, o: { ascending: boolean }) => Promise<{ data: ExperimentRow[] | null }>
      }
    }
  }
  const base = (db.from('experiments' as never) as unknown as Chain).select('*').eq('user_id', userId)
  const res = opts.status
    ? await base.eq('status', opts.status).order('created_at', { ascending: false })
    : opts.runId
      ? await base.eq('run_id', opts.runId).order('created_at', { ascending: false })
      : await base.order('created_at', { ascending: false })
  return (res.data ?? []).map(rowToExperiment)
}

export async function addSample(input: SampleInput): Promise<Experiment | null> {
  const db = createServerClient()
  if (!db) return null
  const exp = await getExperiment(input.experimentId)
  if (!exp || exp.status !== 'running') return exp

  const samplesA   = exp.samplesA   + (input.variant === 'a' ? 1 : 0)
  const samplesB   = exp.samplesB   + (input.variant === 'b' ? 1 : 0)
  const successesA = exp.successesA + (input.variant === 'a' ? input.success : 0)
  const successesB = exp.successesB + (input.variant === 'b' ? input.success : 0)

  const test = twoProportionZTest(successesA, samplesA, successesB, samplesB)
  const hitConfidence = test.winner !== 'tie' && test.confidence >= CONFIDENCE_TARGET

  const patch: Record<string, unknown> = {
    samples_a:   samplesA,
    samples_b:   samplesB,
    successes_a: successesA,
    successes_b: successesB,
    confidence:  test.confidence,
    updated_at:  new Date().toISOString(),
  }
  if (hitConfidence) {
    patch.winner     = test.winner
    patch.status     = 'decided'
    patch.decided_at = new Date().toISOString()
  }

  const { data, error } = await (db.from('experiments' as never) as unknown as {
    update: (rec: unknown) => { eq: (c: string, v: string) => { select: () => { single: () => Promise<{ data: ExperimentRow | null; error: unknown }> } } }
  }).update(patch).eq('id', exp.id).select().single()
  if (error || !data) return null
  const updated = rowToExperiment(data)

  // Loser → workflow_feedback. Only once (status was 'running' before this call).
  if (hitConfidence) {
    await fileLoserFeedback(updated, test.winner)
  }
  return updated
}

async function fileLoserFeedback(exp: Experiment, winner: ExperimentWinner): Promise<void> {
  if (winner === 'tie') return
  const db = createServerClient()
  if (!db) return
  const loser        = winner === 'a' ? exp.variantB : exp.variantA
  const winnerVariant = winner === 'a' ? exp.variantA : exp.variantB
  if (!loser.agentSlug) return
  const feedback = `lost-to: variant-${winnerVariant.id} (experiment ${exp.id.slice(0, 8)}, ` +
    `conf ${((exp.confidence ?? 0) * 100).toFixed(1)}%, ` +
    `rate ${exp.samplesA > 0 ? (exp.successesA / exp.samplesA).toFixed(3) : '0.000'} vs ` +
    `${exp.samplesB > 0 ? (exp.successesB / exp.samplesB).toFixed(3) : '0.000'})`
  try {
    await (db.from('workflow_feedback' as never) as unknown as {
      insert: (rec: unknown) => Promise<{ error: { message: string } | null }>
    }).insert({
      user_id:    exp.userId,
      agent_slug: loser.agentSlug,
      feedback,
      status:     'open',
    })
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[experiments] fileLoserFeedback failed:', err)
    }
  }
}
