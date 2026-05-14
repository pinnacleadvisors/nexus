/**
 * PATCH  /api/views/tasks/[id]  — body: { done?, title?, description?, due_at? }
 * DELETE /api/views/tasks/[id]
 *
 * Ownership is enforced by the helpers (every UPDATE / DELETE includes
 * `user_id = <Clerk userId>` server-side — a stolen task id can't be
 * mutated by another user).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { updateTask, deleteTask } from '@/lib/views/tasks'

export const runtime    = 'nodejs'
export const maxDuration = 10

interface PatchBody { done?: boolean; title?: string; description?: string | null; due_at?: string | null }

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'views:tasks:patch' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  let body: PatchBody = {}
  try { body = await req.json() } catch { /* validate below */ }
  const patch: PatchBody = {}
  if (typeof body.done === 'boolean')    patch.done = body.done
  if (typeof body.title === 'string')    patch.title = body.title
  if (body.description !== undefined)    patch.description = body.description
  if (body.due_at !== undefined)         patch.due_at = body.due_at ?? null
  if (Object.keys(patch).length === 0)   return NextResponse.json({ ok: false, error: 'nothing to update' }, { status: 400 })

  const row = await updateTask(session.userId, id, patch)
  if (!row) return NextResponse.json({ ok: false, error: 'task not found or update failed' }, { status: 404 })
  return NextResponse.json({ ok: true, task: row })
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'views:tasks:delete' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  const ok = await deleteTask(session.userId, id)
  return NextResponse.json({ ok })
}
