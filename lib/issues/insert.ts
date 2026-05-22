/**
 * insertIssue / insertIssueComment — fail-soft inserts that gracefully handle
 * the case where migration 048_issues.sql has not yet been applied.
 *
 * Pattern mirrors lib/goals/insert.ts: try the insert; on missing-table error,
 * cache + log once + return {id: null, error: null}. Callers branch on id=null
 * to skip downstream linkage (e.g. issues.parent_id, issue_comments.issue_id).
 *
 * Single-assignee invariant (enforced at DB layer via CHECK constraint) is
 * also pre-enforced here so we surface "both/neither assignee set" as an
 * explicit error rather than a CHECK violation that looks like a missing
 * table to the auto-retry path.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

export type IssueStatusCategory =
  | 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled'

export interface IssueInsert {
  business_slug:    string
  title:            string
  goal_id?:         string | null
  parent_id?:       string | null
  assignee_agent?:  string | null
  assignee_user?:   string | null
  status_category?: IssueStatusCategory
  status?:          string
  body?:            string | null
}

export interface IssueCommentInsert {
  issue_id:      string
  body:          string
  author_agent?: string | null
  author_user?:  string | null
}

export interface InsertResult {
  id: string | null
  error: { message: string } | null
}

let issuesTableAvailable: boolean | null = null
let issueCommentsTableAvailable: boolean | null = null

function isMissingTable(name: string, message: string): boolean {
  if (!message) return false
  return new RegExp(`relation .*${name}.* does not exist`, 'i').test(message)
}

function validateSingleAssignee(row: IssueInsert): string | null {
  const hasAgent = Boolean(row.assignee_agent)
  const hasUser  = Boolean(row.assignee_user)
  if (hasAgent && hasUser) return 'assignee_agent and assignee_user are mutually exclusive'
  return null
}

export async function insertIssue(
  db: SupabaseClient<Database>,
  row: IssueInsert,
): Promise<InsertResult> {
  const guardError = validateSingleAssignee(row)
  if (guardError) return { id: null, error: { message: guardError } }

  if (issuesTableAvailable === false) {
    return { id: null, error: null }
  }

  const from = (db as unknown as {
    from: (t: string) => {
      insert: (r: IssueInsert) => {
        select: (cols: string) => {
          single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>
        }
      }
    }
  }).from('issues')

  const res = await from.insert(row).select('id').single()

  if (res.error && isMissingTable('issues', res.error.message)) {
    if (issuesTableAvailable === null) {
      console.warn(
        '[insertIssue] issues table missing — apply migration 048_issues. Returning {id: null} so callers fail-soft.',
      )
    }
    issuesTableAvailable = false
    return { id: null, error: null }
  }

  if (!res.error && issuesTableAvailable === null) issuesTableAvailable = true
  return { id: res.data?.id ?? null, error: res.error }
}

export async function insertIssueComment(
  db: SupabaseClient<Database>,
  row: IssueCommentInsert,
): Promise<InsertResult> {
  const hasAgent = Boolean(row.author_agent)
  const hasUser  = Boolean(row.author_user)
  if (hasAgent === hasUser) {
    return { id: null, error: { message: 'author_agent and author_user are mutually exclusive (exactly one required)' } }
  }

  if (issueCommentsTableAvailable === false) {
    return { id: null, error: null }
  }

  const from = (db as unknown as {
    from: (t: string) => {
      insert: (r: IssueCommentInsert) => {
        select: (cols: string) => {
          single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>
        }
      }
    }
  }).from('issue_comments')

  const res = await from.insert(row).select('id').single()

  if (res.error && isMissingTable('issue_comments', res.error.message)) {
    if (issueCommentsTableAvailable === null) {
      console.warn(
        '[insertIssueComment] issue_comments table missing — apply migration 048_issues. Returning {id: null} so callers fail-soft.',
      )
    }
    issueCommentsTableAvailable = false
    return { id: null, error: null }
  }

  if (!res.error && issueCommentsTableAvailable === null) issueCommentsTableAvailable = true
  return { id: res.data?.id ?? null, error: res.error }
}
