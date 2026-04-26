/**
 * POST /api/cron/daily-extract — E6
 *
 * Builds `memory/daily/YYYY-MM-DD.md` for the previous UTC day (or `?date=YYYY-MM-DD`
 * when supplied). Owner-only. Best-effort filesystem write — on Vercel the repo
 * filesystem is read-only, so the route returns the markdown body for the caller
 * (a GitHub Action or Inngest job) to commit.
 */

import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { guardRequest } from '@/lib/guard'
import { buildDailyNote } from '@/lib/runs/daily-extractor'

export const runtime = 'nodejs'
export const maxDuration = 60

function getAllowedUserIds(): Set<string> | null {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return null
  return new Set(raw.split(',').map(id => id.trim()).filter(Boolean))
}

function isOwner(userId: string): boolean {
  const allowed = getAllowedUserIds()
  if (!allowed) return true
  return allowed.has(userId)
}

function yesterdayUtc(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

function isValidDateIso(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'))
}

export async function POST(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 8, window: '1 h', prefix: 'cron:daily-extract' },
  })
  if ('response' in g) return g.response
  if (!isOwner(g.userId)) return NextResponse.json({ error: 'owner only' }, { status: 403 })

  const url = new URL(req.url)
  const dateParam = url.searchParams.get('date')
  const dateIso = dateParam && isValidDateIso(dateParam) ? dateParam : yesterdayUtc()

  const note = await buildDailyNote(dateIso)

  let written: string | null = null
  try {
    const dir = path.join(process.cwd(), 'memory', 'daily')
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, `${dateIso}.md`)
    await fs.writeFile(file, note.content, 'utf8')
    written = file
  } catch {
    // serverless filesystem is read-only — return the body for the caller to commit.
  }

  return NextResponse.json({
    ok: true,
    dateIso,
    written,
    counts: note.counts,
    contentBytes: note.content.length,
    content: written ? undefined : note.content,
  })
}
