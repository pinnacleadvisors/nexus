/**
 * GET /api/learn/session?size=10
 *
 * Returns the next batch of due flashcards, interleaved across MOCs (round
 * robin per moc_slug). When fewer cards are due than `size`, falls back to
 * the lowest-retrievability cards in the user's deck so the operator can
 * still drill the weakest knowledge on a quiet day.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import type { Flashcard } from '@/lib/types'
import { DEFAULT_SESSION_SIZE } from '@/lib/learning/types'

export const runtime = 'nodejs'

interface RawCard {
  id: string
  user_id: string
  kind: string
  moc_slug: string | null
  atom_slug: string
  source_sha: string
  front: string
  back: string
  options: unknown
  reference_context: string | null
  state: string
  stability: number
  difficulty: number
  retrievability: number
  due_at: string
  crown: number
  streak_count: number
  last_reviewed_at: string | null
  stale_reason: string | null
  created_at: string
  updated_at: string
}

function rawToCard(r: RawCard): Flashcard {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind as Flashcard['kind'],
    mocSlug: r.moc_slug,
    atomSlug: r.atom_slug,
    sourceSha: r.source_sha,
    front: r.front,
    back: r.back,
    options: Array.isArray(r.options) ? (r.options as string[]) : undefined,
    referenceContext: r.reference_context ?? undefined,
    state: r.state as Flashcard['state'],
    stability: r.stability,
    difficulty: r.difficulty,
    retrievability: r.retrievability,
    dueAt: r.due_at,
    crown: r.crown,
    streakCount: r.streak_count,
    lastReviewedAt: r.last_reviewed_at,
    staleReason: r.stale_reason ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/** Round-robin interleave by `moc_slug` so a session always mixes topics. */
function interleave(cards: RawCard[]): RawCard[] {
  const buckets = new Map<string, RawCard[]>()
  for (const c of cards) {
    const k = c.moc_slug ?? '__none__'
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k)!.push(c)
  }
  const out: RawCard[] = []
  let active = Array.from(buckets.values())
  while (active.length > 0) {
    const next: RawCard[][] = []
    for (const b of active) {
      const head = b.shift()
      if (head) out.push(head)
      if (b.length > 0) next.push(b)
    }
    active = next
  }
  return out
}

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const size = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('size') ?? DEFAULT_SESSION_SIZE)))
  const sb = createServerClient()
  if (!sb) return NextResponse.json({ cards: [], source: 'mock' })

  type Loose = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
  const db = sb as unknown as Loose

  const dueResp = await db
    .from('flashcards')
    .select('*')
    .eq('user_id', userId)
    .neq('state', 'archived')
    .lte('due_at', new Date().toISOString())
    .order('due_at', { ascending: true })
    .limit(size * 3) // grab extras so interleave has options
  let due = ((dueResp as unknown as { data: RawCard[] | null }).data ?? []) as RawCard[]

  // Fallback: lowest-retrievability cards if nothing's due.
  if (due.length === 0) {
    const fallbackResp = await db
      .from('flashcards')
      .select('*')
      .eq('user_id', userId)
      .neq('state', 'archived')
      .order('retrievability', { ascending: true })
      .limit(size)
    due = ((fallbackResp as unknown as { data: RawCard[] | null }).data ?? []) as RawCard[]
  }

  const interleaved = interleave(due).slice(0, size)
  return NextResponse.json({
    cards: interleaved.map(rawToCard),
    source: 'supabase',
    dueCount: due.length,
  })
}
