/**
 * GET /api/learn/path
 *
 * Returns the Duolingo-style path: each MOC is a unit, each linked atom is a
 * lesson with its current crown, card count, and next-due timestamp. Drives
 * the home page at `/learn`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import type { LearnPathLesson, LearnPathUnit } from '@/lib/types'

export const runtime = 'nodejs'

interface CardSlim {
  atom_slug: string
  moc_slug: string | null
  crown: number
  due_at: string
  state: string
  stale_reason: string | null
}

export async function GET(_req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = createServerClient()
  if (!sb) return NextResponse.json({ units: [] })

  type Loose = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
  const db = sb as unknown as Loose

  const cardsResp = await db.from('flashcards')
    .select('atom_slug, moc_slug, crown, due_at, state, stale_reason')
    .eq('user_id', userId)
    .neq('state', 'archived')
  const cards = (cardsResp.data ?? []) as CardSlim[]

  if (cards.length === 0) return NextResponse.json({ units: [] })

  const atomSlugs = Array.from(new Set(cards.map(c => c.atom_slug)))
  const mocSlugs = Array.from(new Set(cards.map(c => c.moc_slug).filter((m): m is string => Boolean(m))))

  const atomsResp = await db.from('mol_atoms').select('slug, title').in('slug', atomSlugs)
  const atomTitle = new Map<string, string>()
  for (const row of (atomsResp.data ?? []) as Array<{ slug: string; title: string }>) {
    atomTitle.set(row.slug, row.title)
  }

  const mocsResp = mocSlugs.length > 0
    ? await db.from('mol_mocs').select('slug, title').in('slug', mocSlugs)
    : { data: [] }
  const mocTitle = new Map<string, string>()
  for (const row of (mocsResp.data ?? []) as Array<{ slug: string; title: string }>) {
    mocTitle.set(row.slug, row.title)
  }

  // Aggregate: atom -> max crown, earliest dueAt, count, stale flag.
  type Acc = { crown: number; nextDueAt: string | null; cardCount: number; isStale: boolean; mocSlug: string | null }
  const byAtom = new Map<string, Acc>()
  for (const c of cards) {
    const cur = byAtom.get(c.atom_slug) ?? { crown: 0, nextDueAt: null, cardCount: 0, isStale: false, mocSlug: c.moc_slug }
    cur.crown = Math.max(cur.crown, c.crown)
    cur.cardCount += 1
    if (c.stale_reason) cur.isStale = true
    if (cur.nextDueAt === null || c.due_at < cur.nextDueAt) cur.nextDueAt = c.due_at
    if (!cur.mocSlug && c.moc_slug) cur.mocSlug = c.moc_slug
    byAtom.set(c.atom_slug, cur)
  }

  // Group atoms under their MOC.
  const byMoc = new Map<string, LearnPathLesson[]>()
  byMoc.set('__none__', [])
  for (const [atomSlug, acc] of byAtom.entries()) {
    const lesson: LearnPathLesson = {
      atomSlug,
      title: atomTitle.get(atomSlug) ?? atomSlug,
      crown: acc.crown,
      cardCount: acc.cardCount,
      nextDueAt: acc.nextDueAt,
      isStale: acc.isStale,
    }
    const key = acc.mocSlug ?? '__none__'
    if (!byMoc.has(key)) byMoc.set(key, [])
    byMoc.get(key)!.push(lesson)
  }

  const units: LearnPathUnit[] = []
  for (const [mocSlug, lessons] of byMoc.entries()) {
    if (lessons.length === 0) continue
    const sorted = lessons.sort((a, b) => a.title.localeCompare(b.title))
    const total = sorted.length * 5
    const earned = sorted.reduce((sum, l) => sum + l.crown, 0)
    units.push({
      mocSlug: mocSlug === '__none__' ? '' : mocSlug,
      title: mocSlug === '__none__' ? 'Uncategorised' : (mocTitle.get(mocSlug) ?? mocSlug),
      lessons: sorted,
      progress: total > 0 ? earned / total : 0,
    })
  }

  units.sort((a, b) => a.title.localeCompare(b.title))
  return NextResponse.json({ units })
}
