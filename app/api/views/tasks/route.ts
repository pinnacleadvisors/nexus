/**
 * GET  /api/views/tasks?scope=<scope>&done=<bool>
 * POST /api/views/tasks      — body: { scope, title, description?, due_at? }
 *
 * Backs the Tasks panel in the chat Views dropdown. Scope must be either
 * 'admin' (platform-chat) or 'business:<slug>' (per-business chat).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { listTasks, createTask } from '@/lib/views/tasks'
import { isBusinessSlug } from '@/lib/claw/business-client'

export const runtime    = 'nodejs'
export const maxDuration = 10

function validScope(s: string | null): s is string {
  if (!s) return false
  if (s === 'admin') return true
  if (s.startsWith('business:')) return isBusinessSlug(s.slice('business:'.length))
  return false
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 120, window: '1 m', prefix: 'views:tasks:list' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const u = new URL(req.url)
  const scope = u.searchParams.get('scope')
  if (!validScope(scope)) return NextResponse.json({ ok: false, error: 'invalid scope' }, { status: 400 })

  const doneParam = u.searchParams.get('done')
  const done = doneParam === 'true' ? true : doneParam === 'false' ? false : undefined
  const tasks = await listTasks(session.userId, scope, { done })

  return NextResponse.json({ ok: true, tasks })
}

interface CreateBody { scope?: string; title?: string; description?: string; due_at?: string }

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'views:tasks:create' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: CreateBody = {}
  try { body = await req.json() } catch { /* fall through to validation */ }
  if (!validScope(body.scope ?? null)) return NextResponse.json({ ok: false, error: 'invalid scope' }, { status: 400 })
  if (typeof body.title !== 'string' || !body.title.trim()) return NextResponse.json({ ok: false, error: 'title required' }, { status: 400 })

  const row = await createTask({
    userId:      session.userId,
    scope:       body.scope as string,
    title:       body.title,
    description: body.description,
    dueAt:       body.due_at && !Number.isNaN(Date.parse(body.due_at)) ? new Date(body.due_at).toISOString() : null,
    source:      'operator',
  })
  if (!row) return NextResponse.json({ ok: false, error: 'failed to create task' }, { status: 500 })
  return NextResponse.json({ ok: true, task: row })
}
