export interface ApprovalItem {
  id:               string
  business_slug:    string
  type:             string
  status:           string
  payload:          Record<string, unknown> | null
  created_by_agent: string | null
  created_at:       string
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

export type InboxKind = 'approval' | 'issue' | 'activity'

export type InboxItem =
  | { kind: 'approval'; id: string; business_slug: string; created_at: string; data: ApprovalItem }
  | { kind: 'issue';    id: string; business_slug: string; created_at: string; data: IssueItem }
  | { kind: 'activity'; id: string; business_slug: string; created_at: string; data: ActivityItem }
