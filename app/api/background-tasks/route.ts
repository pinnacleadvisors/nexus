/**
 * GET /api/background-tasks?scope=<scope>&status=pending,running
 *
 * Lists background tasks for the current operator within a scope. Owner-only
 * via Clerk auth; service-role write happens inside listBackgroundTasks().
 *
 * Phase 4 of task_plan-collaborative-chat.md. v1 = read-only list endpoint
 * for the BackgroundTasksView; v2 will add a POST companion when we wire
 * operator-initiated background tasks ("+ New background task" UI button).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { listBackgroundTasks, type BackgroundTaskStatus } from '@/lib/background-tasks/dispatch'

export const runtime = 'nodejs'
export const maxDuration = 10

const ALL_STATUSES: BackgroundTaskStatus[] = ['pending', 'running', 'done', 'error', 'cancelled']

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth()
  if (!session.userId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const scope = url.searchParams.get('scope') ?? 'admin'
  const statusParam = url.searchParams.get('status')
  const statuses = statusParam
    ? statusParam.split(',').map(s => s.trim()).filter((s): s is BackgroundTaskStatus => ALL_STATUSES.includes(s as BackgroundTaskStatus))
    : undefined
  const rows = await listBackgroundTasks(session.userId, scope, { statuses, limit: 100 })
  return NextResponse.json({ ok: true, tasks: rows })
}
