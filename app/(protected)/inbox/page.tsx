/**
 * /inbox — unified inbox absorbing Paperclip's Inbox surface.
 *
 * Four signals consolidated into one chronological view:
 *   1. Pending approvals across every business (the existing /approvals data,
 *      now visible alongside other work — operator no longer has to context-
 *      switch between routes to triage)
 *   2. Open issues assigned to the operator (assignee_user = current user)
 *   3. Manual to-dos (`operator_tasks` — the deferred-audit backlog seeded
 *      via /api/admin/seed-deferred-tasks + chat-agent `manual-task` blocks)
 *   4. Recent platform activity — run_events tail for context
 *
 * Replaces /signals as the operator's "what needs my attention" surface.
 * /signals stays routable for now but is dropped from the sidebar; a
 * follow-up PR migrates the signals logic into platform-copilot via skill
 * dispatch (the chat agent has richer context than a static dashboard).
 *
 * Filter tabs in the client subcomponent — server fetches all four buckets
 * once and the client filters in-memory (sub-100-item lists; no pagination
 * yet). When the workload outgrows that, switch to per-tab URL state + server
 * filtering.
 */

import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase'
import InboxClient from '@/components/inbox/InboxClient'
import type { InboxItem, ApprovalItem, IssueItem, ActivityItem, TaskItem } from '@/components/inbox/types'
import { listFleetPending } from '@/lib/approvals/fleet'
import { Inbox as InboxIcon } from 'lucide-react'

const APPROVAL_LIMIT = 50
const ISSUE_LIMIT    = 50
const TASK_LIMIT     = 100  // higher cap — the deferred-audit backlog alone is 20+
const ACTIVITY_LIMIT = 30

interface AnyChain extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  select: (cols: string) => AnyChain
  eq:     (col: string, val: string) => AnyChain
  in:     (col: string, vals: string[]) => AnyChain
  gte:    (col: string, val: string) => AnyChain
  order:  (col: string, opts: { ascending: boolean }) => AnyChain
  limit:  (n: number) => AnyChain
}

async function fetchAll(userId: string): Promise<InboxItem[]> {
  const db = createServerClient()
  if (!db) return []

  const anyDb  = db as unknown as { from: (t: string) => AnyChain }
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [approvalsRes, issuesRes, tasksRes, eventsRes] = await Promise.all([
    anyDb.from('approvals')
      .select('id,business_slug,type,status,payload,created_by_agent,created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(APPROVAL_LIMIT),
    anyDb.from('issues')
      .select('id,business_slug,title,status,status_category,assignee_user,assignee_agent,goal_id,parent_id,created_at,updated_at')
      .eq('assignee_user', userId)
      .in('status_category', ['unstarted', 'started', 'backlog', 'triage'])
      .order('updated_at', { ascending: false })
      .limit(ISSUE_LIMIT),
    // Manual to-dos — operator_tasks where !done. Includes the deferred-
    // audit backlog (admin scope, source='operator') and any chat-agent
    // `manual-task` rows (source='agent'). Both surface here.
    anyDb.from('operator_tasks')
      .select('id,scope,title,description,source,due_at,created_at,done')
      .eq('user_id', userId)
      .eq('done',    'false')
      .order('created_at', { ascending: false })
      .limit(TASK_LIMIT),
    anyDb.from('run_events')
      .select('id,run_id,business_slug,event_type,payload,created_at')
      .gte('created_at', since7d)
      .order('created_at', { ascending: false })
      .limit(ACTIVITY_LIMIT),
  ])

  const items: InboxItem[] = []

  for (const row of (approvalsRes.data ?? []) as Array<Record<string, unknown>>) {
    items.push({
      kind:          'approval',
      id:            row.id as string,
      business_slug: row.business_slug as string,
      created_at:    row.created_at as string,
      data: {
        id:               row.id as string,
        business_slug:    row.business_slug as string,
        type:             row.type as string,
        status:           row.status as string,
        payload:          (row.payload ?? null) as Record<string, unknown> | null,
        created_by_agent: (row.created_by_agent ?? null) as string | null,
        created_at:       row.created_at as string,
        origin:           'operator-task',
      } satisfies ApprovalItem,
    })
  }

  // ALSO pull chat-emitted approvals via the unified fleet aggregator, so
  // the inbox approval count matches the dashboard tile. The aggregator
  // already includes the `approvals` table rows we just pulled above —
  // we drop those duplicates here via the `kind: 'chat-emitted'` filter.
  try {
    const fleet = await listFleetPending(db, userId)
    for (const f of fleet) {
      if (f.kind !== 'chat-emitted') continue   // operator-task already loaded above
      const slug = f.scope.startsWith('business:')
        ? f.scope.slice('business:'.length)
        : '__platform'
      items.push({
        kind:          'approval',
        id:            f.message_id,
        business_slug: slug,
        created_at:    f.created_at,
        data: {
          id:               f.message_id,
          business_slug:    slug,
          type:             'chat_request',
          status:           'pending',
          payload:          { title: f.approval.title, items: f.approval.items },
          created_by_agent: null,
          created_at:       f.created_at,
          origin:           'chat-emitted',
          session_id:       f.session_id,
          approval_id:      f.approval.approval_id,
        } satisfies ApprovalItem,
      })
    }
  } catch (err) {
    console.warn('[/inbox] listFleetPending failed:', err instanceof Error ? err.message : err)
  }
  for (const row of (issuesRes.data ?? []) as Array<Record<string, unknown>>) {
    items.push({
      kind:          'issue',
      id:            row.id as string,
      business_slug: row.business_slug as string,
      created_at:    (row.updated_at as string) ?? (row.created_at as string),
      data: {
        id:              row.id as string,
        business_slug:   row.business_slug as string,
        title:           row.title as string,
        status:          row.status as string,
        status_category: row.status_category as string,
        assignee_agent:  (row.assignee_agent ?? null) as string | null,
        assignee_user:   (row.assignee_user ?? null) as string | null,
        updated_at:      (row.updated_at ?? row.created_at) as string,
      } satisfies IssueItem,
    })
  }
  for (const row of (tasksRes.data ?? []) as Array<Record<string, unknown>>) {
    const scope = row.scope as string
    // Derive a business_slug for sort/group purposes: 'business:foo' → 'foo'; 'admin' → '__platform'.
    const business_slug = scope.startsWith('business:') ? scope.slice('business:'.length) : '__platform'
    items.push({
      kind:          'task',
      id:            row.id as string,
      business_slug,
      created_at:    row.created_at as string,
      data: {
        id:          row.id as string,
        scope,
        title:       row.title as string,
        description: (row.description ?? null) as string | null,
        source:      (row.source ?? 'operator') as 'operator' | 'agent',
        due_at:      (row.due_at ?? null) as string | null,
        created_at:  row.created_at as string,
      } satisfies TaskItem,
    })
  }
  for (const row of (eventsRes.data ?? []) as Array<Record<string, unknown>>) {
    items.push({
      kind:          'activity',
      id:            row.id as string,
      business_slug: (row.business_slug ?? '__platform') as string,
      created_at:    row.created_at as string,
      data: {
        id:            row.id as string,
        run_id:        (row.run_id ?? null) as string | null,
        business_slug: (row.business_slug ?? null) as string | null,
        event_type:    row.event_type as string,
        payload:       (row.payload ?? null) as Record<string, unknown> | null,
        created_at:    row.created_at as string,
      } satisfies ActivityItem,
    })
  }

  // Single chronological merge — newest first.
  items.sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
  return items
}

export default async function InboxPage() {
  const session = await auth()
  if (!session.userId) redirect('/sign-in?returnUrl=/inbox')

  const items = await fetchAll(session.userId)

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6 flex items-center gap-3">
        <InboxIcon className="h-6 w-6 text-zinc-400" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="text-sm text-zinc-400">
            Approvals · issues assigned to you · recent activity. Single chronological feed across all businesses.
          </p>
        </div>
      </header>

      <InboxClient items={items} />
    </div>
  )
}
