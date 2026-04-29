/**
 * lib/signals/client.ts
 *
 * CRUD for the signals inbox + its evaluation rows. Mirrors the access shape
 * of lib/experiments/client.ts so type drift between Supabase rows and the
 * exported domain types stays narrow.
 */

import { createServerClient } from '@/lib/supabase'
import type {
  CouncilRole,
  CreateSignalInput,
  Signal,
  SignalEvaluation,
  SignalStatus,
  SignalWithEvaluations,
} from './types'

interface SignalRow {
  id:             string
  user_id:        string
  kind:           Signal['kind']
  title:          string
  body:           string
  url:            string | null
  status:         SignalStatus
  decided_reason: string | null
  decided_at:     string | null
  created_at:     string
  updated_at:     string
}

interface EvaluationRow {
  id:         string
  signal_id:  string
  user_id:    string
  role:       CouncilRole
  verdict:    string | null
  reasoning:  string
  model:      string | null
  created_at: string
}

function rowToSignal(r: SignalRow): Signal {
  return {
    id:            r.id,
    userId:        r.user_id,
    kind:          r.kind,
    title:         r.title,
    body:          r.body,
    url:           r.url ?? undefined,
    status:        r.status,
    decidedReason: r.decided_reason ?? undefined,
    decidedAt:     r.decided_at ?? undefined,
    createdAt:     r.created_at,
    updatedAt:     r.updated_at,
  }
}

function rowToEvaluation(r: EvaluationRow): SignalEvaluation {
  return {
    id:        r.id,
    signalId:  r.signal_id,
    userId:    r.user_id,
    role:      r.role,
    verdict:   r.verdict ?? undefined,
    reasoning: r.reasoning,
    model:     r.model ?? undefined,
    createdAt: r.created_at,
  }
}

// ── Signals ──────────────────────────────────────────────────────────────────
export async function createSignal(userId: string, input: CreateSignalInput): Promise<Signal | null> {
  const db = createServerClient()
  if (!db) return null
  const { data, error } = await (db.from('signals' as never) as unknown as {
    insert: (rec: unknown) => { select: () => { single: () => Promise<{ data: SignalRow | null; error: { message: string } | null }> } }
  }).insert({
    user_id: userId,
    kind:    input.kind,
    title:   input.title,
    body:    input.body ?? '',
    url:     input.url  ?? null,
  }).select().single()
  if (error || !data) return null
  return rowToSignal(data)
}

export async function getSignal(id: string): Promise<Signal | null> {
  const db = createServerClient()
  if (!db) return null
  const { data } = await (db.from('signals' as never) as unknown as {
    select: (cols: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: SignalRow | null }> } }
  }).select('*').eq('id', id).maybeSingle()
  return data ? rowToSignal(data) : null
}

export interface ListSignalsOpts {
  status?: SignalStatus
  limit?:  number
}

export async function listSignals(userId: string, opts: ListSignalsOpts = {}): Promise<Signal[]> {
  const db = createServerClient()
  if (!db) return []
  type Chain = {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        eq:    (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: SignalRow[] | null }> } }
        order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: SignalRow[] | null }> }
      }
    }
  }
  const limit = opts.limit ?? 200
  const base  = (db.from('signals' as never) as unknown as Chain).select('*').eq('user_id', userId)
  const res = opts.status
    ? await base.eq('status', opts.status).order('created_at', { ascending: false }).limit(limit)
    : await base.order('created_at', { ascending: false }).limit(limit)
  return (res.data ?? []).map(rowToSignal)
}

/** Pulls signals waiting for a council pass. Cron uses this. */
export async function listNewSignals(limit = 5): Promise<Signal[]> {
  const db = createServerClient()
  if (!db) return []
  const { data } = await (db.from('signals' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: SignalRow[] | null }> }
      }
    }
  }).select('*').eq('status', 'new').order('created_at', { ascending: true }).limit(limit)
  return (data ?? []).map(rowToSignal)
}

export interface UpdateSignalInput {
  status?:        SignalStatus
  decidedReason?: string
  decidedAt?:     string | null
}

export async function updateSignal(id: string, patch: UpdateSignalInput): Promise<Signal | null> {
  const db = createServerClient()
  if (!db) return null
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.status        !== undefined) update.status         = patch.status
  if (patch.decidedReason !== undefined) update.decided_reason = patch.decidedReason
  if (patch.decidedAt     !== undefined) update.decided_at     = patch.decidedAt
  const { data, error } = await (db.from('signals' as never) as unknown as {
    update: (rec: unknown) => { eq: (c: string, v: string) => { select: () => { single: () => Promise<{ data: SignalRow | null; error: unknown }> } } }
  }).update(update).eq('id', id).select().single()
  if (error || !data) return null
  return rowToSignal(data)
}

// ── Evaluations ──────────────────────────────────────────────────────────────
export interface CreateEvaluationInput {
  signalId:  string
  role:      CouncilRole
  verdict?:  string
  reasoning: string
  model?:    string
}

export async function createEvaluation(userId: string, input: CreateEvaluationInput): Promise<SignalEvaluation | null> {
  const db = createServerClient()
  if (!db) return null
  const { data, error } = await (db.from('signal_evaluations' as never) as unknown as {
    insert: (rec: unknown) => { select: () => { single: () => Promise<{ data: EvaluationRow | null; error: unknown }> } }
  }).insert({
    signal_id: input.signalId,
    user_id:   userId,
    role:      input.role,
    verdict:   input.verdict   ?? null,
    reasoning: input.reasoning,
    model:     input.model     ?? null,
  }).select().single()
  if (error || !data) return null
  return rowToEvaluation(data)
}

export async function listEvaluations(signalId: string): Promise<SignalEvaluation[]> {
  const db = createServerClient()
  if (!db) return []
  const { data } = await (db.from('signal_evaluations' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => Promise<{ data: EvaluationRow[] | null }> }
    }
  }).select('*').eq('signal_id', signalId).order('created_at', { ascending: true })
  return (data ?? []).map(rowToEvaluation)
}

export async function getSignalWithEvaluations(id: string): Promise<SignalWithEvaluations | null> {
  const signal = await getSignal(id)
  if (!signal) return null
  const evaluations = await listEvaluations(id)
  return { ...signal, evaluations }
}
