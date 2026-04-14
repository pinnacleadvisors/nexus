/**
 * app/api/library/[id]/route.ts
 * PATCH  /api/library/:id  { type, action: 'increment_usage' | 'update_score', score? }
 * DELETE /api/library/:id?type=code
 */

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { incrementUsage, updateQualityScore, deleteEntry } from '@/lib/library/client'
import type { LibraryType } from '@/lib/library/types'

const VALID_TYPES: LibraryType[] = ['code', 'agent', 'prompt', 'skill']

interface RouteParams {
  params: Promise<{ id: string }>
}

// ── PATCH ─────────────────────────────────────────────────────────────────────
export async function PATCH(req: Request, { params }: RouteParams) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const type   = body.type as LibraryType
  const action = body.action as string

  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }

  try {
    if (action === 'increment_usage') {
      await incrementUsage(type, id, userId)
      return NextResponse.json({ ok: true })
    }

    if (action === 'update_score') {
      const score = typeof body.score === 'number' ? body.score : parseFloat(String(body.score))
      if (isNaN(score)) return NextResponse.json({ error: 'score must be a number 0–1' }, { status: 400 })
      await updateQualityScore(type, id, userId, score)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('[library/[id]] PATCH error:', err)
    return NextResponse.json({ error: 'Operation failed' }, { status: 500 })
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────
export async function DELETE(req: Request, { params }: RouteParams) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { searchParams } = new URL(req.url)
  const type = (searchParams.get('type') ?? 'code') as LibraryType

  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }

  const ok = await deleteEntry(type, id, userId)
  if (!ok) return NextResponse.json({ error: 'Not found or forbidden' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
