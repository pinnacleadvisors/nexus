/**
 * POST /api/cron/platform-dev-tick — catch-up dispatcher for the
 * platform-dev-loop autonomous-issue agent (PR #378).
 *
 * Every 30 min, looks for issues that:
 *   - have assignee_agent='platform-dev'
 *   - are status_category='triage' (operator just filed) OR
 *     status_category='started' with metadata.failed=true and
 *     metadata.last_callback_at older than 24h (cooldown after failure)
 *
 * For each, re-dispatches the platform-dev-loop agent. Useful when the
 * initial POST /api/issues dispatch failed (transient gateway error)
 * OR when a prior run reported `failed` and the operator wants a fresh
 * attempt without manually re-filing.
 *
 * Auth: Bearer ${CRON_SECRET}. Returns 200 always (retry-storm rule).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { dispatchPlatformDev } from '@/lib/platform-dev/dispatch'

export const runtime    = 'nodejs'
export const maxDuration = 60

const RETRY_AFTER_FAILURE_MS = 24 * 60 * 60 * 1000

interface IssueRow {
  id:              string
  business_slug:   string
  title:           string
  body:            string | null
  metadata:        Record<string, unknown> | null
  status_category: string
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET
  const auth     = req.headers.get('authorization') ?? ''
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  // Operator user id — needed for the dispatch helper's context. Use the
  // first ALLOWED_USER_IDS entry (single-tenant).
  const operatorId = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)[0] ?? ''
  if (!operatorId) {
    return NextResponse.json({ ok: false, error: 'no_owner_user_id_in_env' })
  }

  let queue: IssueRow[] = []
  try {
    // Triage-stage issues assigned to platform-dev (just-filed)
    const triageRes = await (db.from('issues' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: IssueRow[] | null }> } } } }
    }).select('id, business_slug, title, body, metadata, status_category')
      .eq('assignee_agent', 'platform-dev')
      .eq('status_category', 'triage')
      .order('created_at', { ascending: true })
      .limit(5)
    queue = queue.concat(triageRes.data ?? [])

    // Started + previously-failed rows past the cooldown
    const startedRes = await (db.from('issues' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: IssueRow[] | null }> } } } }
    }).select('id, business_slug, title, body, metadata, status_category')
      .eq('assignee_agent', 'platform-dev')
      .eq('status_category', 'started')
      .order('updated_at', { ascending: true })
      .limit(10)
    for (const row of startedRes.data ?? []) {
      const meta = row.metadata as { failed?: boolean; last_callback_at?: string } | null
      if (!meta?.failed) continue
      const last = meta.last_callback_at ? new Date(meta.last_callback_at).getTime() : 0
      if (Date.now() - last < RETRY_AFTER_FAILURE_MS) continue
      queue.push(row)
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: 'query_failed', detail: err instanceof Error ? err.message : 'unknown' })
  }

  if (queue.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, note: 'no_pending_platform_dev_issues' })
  }

  const results: Array<{ issue_id: string; ok: boolean; error?: string }> = []
  for (const issue of queue.slice(0, 5)) {
    const out = await dispatchPlatformDev({
      issueId:      issue.id,
      title:        issue.title,
      description:  issue.body,
      businessSlug: issue.business_slug,
      userId:       operatorId,
    })
    results.push({ issue_id: issue.id, ok: out.ok, error: out.error })
  }

  return NextResponse.json({ ok: true, processed: results.length, results })
}
