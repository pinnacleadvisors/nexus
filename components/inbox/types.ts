/**
 * Origin of an approval row in the inbox. Two sources land here:
 *   - 'operator-task'   — row in the `approvals` Postgres table
 *   - 'chat-emitted'    — approval_request parsed out of chat_messages
 *                         metadata (lib/approvals/fleet.ts aggregator)
 * Renderer uses this to render a colour-coded "task" vs "chat" badge.
 */
export type ApprovalOrigin = 'chat-emitted' | 'operator-task'

export interface ApprovalItem {
  id:               string
  business_slug:    string
  type:             string
  status:           string
  payload:          Record<string, unknown> | null
  created_by_agent: string | null
  created_at:       string
  /** Where the approval came from. Optional for back-compat; treat undefined as 'operator-task'. */
  origin?:          ApprovalOrigin
  /** Set on chat-emitted approvals so the UI can deep-link to the source chat session. */
  session_id?:      string
  /** Set on chat-emitted approvals — the original approval_id string from the chat block. */
  approval_id?:     string
}

export interface IssueItem {
  id:              string
  business_slug:   string
  title:           string
  status:          string
  status_category: string
  assignee_agent:  string | null
  assignee_user:   string | null
  updated_at:      string
}

export interface ActivityItem {
  id:            string
  run_id:        string | null
  business_slug: string | null
  event_type:    string
  payload:       Record<string, unknown> | null
  created_at:    string
}

/**
 * Manual to-do row from `operator_tasks`. Surfaced in the inbox so the
 * deferred-audit backlog + chat-agent `manual-task` blocks land in the
 * same "what needs my attention" view as approvals + issues. Mirrors
 * OperatorTaskRow in lib/views/tasks.ts; only the fields the inbox needs.
 */
export interface TaskItem {
  id:          string
  scope:       string         // 'admin' | 'business:<slug>'
  title:       string
  description: string | null
  source:      'operator' | 'agent'
  due_at:      string | null
  created_at:  string
}

/**
 * Read-only system alert — cron failing, run stalled, budget kill-switch
 * fired. Sibling to the dashboard surface added in PR #370. Auto-clears
 * when the underlying source recovers (no operator action needed).
 *
 *   - source:   discriminator for the icon + colour
 *   - title:    human-readable headline
 *   - meta:     short subtitle (e.g. "$50.00 / $50.00 cap")
 *   - href:     deep link to investigate (e.g. /cron-health,
 *               /businesses/<slug>/simulate, /api/health/deep)
 */
export interface SystemAlertItem {
  id:          string
  source:      'cron-alert' | 'stalled-run' | 'budget-incident'
  scope:       string         // 'admin' | 'business:<slug>'
  title:       string
  meta:        string | null
  href:        string | null
  created_at:  string
}

export type InboxKind = 'approval' | 'issue' | 'activity' | 'task' | 'system-alert'

export type InboxItem =
  | { kind: 'approval';     id: string; business_slug: string; created_at: string; data: ApprovalItem }
  | { kind: 'issue';        id: string; business_slug: string; created_at: string; data: IssueItem }
  | { kind: 'activity';     id: string; business_slug: string; created_at: string; data: ActivityItem }
  | { kind: 'task';         id: string; business_slug: string; created_at: string; data: TaskItem }
  | { kind: 'system-alert'; id: string; business_slug: string; created_at: string; data: SystemAlertItem }
