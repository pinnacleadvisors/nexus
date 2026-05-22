import { Bot, User } from 'lucide-react'
import IssueAncestry from './IssueAncestry'
import CommentForm from './CommentForm'
import type { Ancestry } from '@/lib/goals/ancestry'

interface CommentRow {
  id:            string
  body:          string
  author_agent:  string | null
  author_user:   string | null
  created_at:    string
}

interface IssueDetail {
  id:              string
  title:           string
  body:            string | null
  status:          string
  status_category: string
  assignee_agent:  string | null
  assignee_user:   string | null
}

interface Props {
  issue:    IssueDetail
  ancestry: Ancestry | null
  comments: CommentRow[]
}

/**
 * IssueThread — issue body + threaded comments + ancestry breadcrumb.
 *
 * Pure display component. The data fetch (issue row, ancestry via
 * lib/goals/ancestry.ts getIssueAncestry, comments) happens server-side in
 * the parent page. This component renders the result.
 *
 * Comment authoring is NOT wired here — that's a follow-up PR with the
 * POST /api/issues/[id]/comment route + form.
 */
export default function IssueThread({ issue, ancestry, comments }: Props) {
  return (
    <article className="space-y-4">
      {ancestry && (
        <div>
          <IssueAncestry ancestry={ancestry} />
        </div>
      )}

      <header className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <h1 className="text-xl font-medium tracking-tight">{issue.title}</h1>
        <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
          <span className="rounded bg-zinc-800/60 px-1.5 py-0.5">{issue.status}</span>
          <span className="rounded bg-zinc-800/60 px-1.5 py-0.5">{issue.status_category}</span>
          {issue.assignee_agent && (
            <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3" />{issue.assignee_agent}</span>
          )}
          {issue.assignee_user && (
            <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{issue.assignee_user}</span>
          )}
        </div>
        {issue.body && (
          <div className="prose prose-invert mt-4 max-w-none whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
            {issue.body}
          </div>
        )}
      </header>

      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Comments ({comments.length})
        </h2>
        {comments.length === 0 ? (
          <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm italic text-zinc-500">
            No comments yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {comments.map(c => (
              <li key={c.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
                  {c.author_agent ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                  <span>{c.author_agent ?? c.author_user}</span>
                  <span className="text-zinc-700">·</span>
                  <time dateTime={c.created_at}>{new Date(c.created_at).toLocaleString()}</time>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        <CommentForm issueId={issue.id} />
      </section>
    </article>
  )
}
