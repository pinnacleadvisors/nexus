/**
 * POST /api/cron/sync-learning-cards
 *
 * Materialises flashcards from the molecular memory mirror. Runs nightly
 * via vercel.json. Auth: Vercel cron `CRON_SECRET` bearer; alternatively,
 * the owner can invoke it manually while signed in.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { syncCardsFromMolecular } from '@/lib/learning/atom-sync'
import { recordCronRun } from '@/lib/cron/record'

export const runtime = 'nodejs'
export const maxDuration = 60

function isCronAuthed(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const got = req.headers.get('authorization') ?? ''
  return got === `Bearer ${expected}`
}

function ownerUserId(): string | null {
  const explicit = process.env.OWNER_USER_ID?.trim()
  if (explicit) return explicit
  const allowed = process.env.ALLOWED_USER_IDS?.split(',').map(s => s.trim()).filter(Boolean)
  return allowed && allowed.length > 0 ? allowed[0]! : null
}

export async function POST(req: NextRequest) {
  let userId: string | null = null
  if (isCronAuthed(req)) {
    userId = ownerUserId()
  } else {
    const a = await auth()
    userId = a.userId ?? null
  }
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // recordCronRun writes a structured log_events row (route, level, status,
  // duration_ms, message) so /api/health/cron can surface freshness on the
  // /manage-platform Health panel. PR 5 of task_plan-ux-security-onboarding.md.
  const result = await recordCronRun('sync-learning-cards', () => syncCardsFromMolecular(userId))
  return NextResponse.json({ ok: true, ...result })
}

export const GET = POST
