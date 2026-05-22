import { Bot, User } from 'lucide-react'

interface IssueRowData {
  id:              string
  title:           string
  status:          string
  status_category: string
  assignee_agent:  string | null
  assignee_user:   string | null
  updated_at:      string
}

interface Props {
  issue:        IssueRowData
  businessSlug: string
}

function shortRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now  = Date.now()
  const sec  = Math.max(0, Math.floor((now - then) / 1000))
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

export default function IssueRow({ issue }: Props) {
  const Icon = issue.assignee_agent ? Bot : issue.assignee_user ? User : null
  const assignee = issue.assignee_agent ?? issue.assignee_user ?? 'unassigned'

  return (
    <li className="px-4 py-3 transition hover:bg-zinc-800/40">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-sm text-zinc-200">{issue.title}</p>
        <span className="hidden flex-shrink-0 text-xs text-zinc-500 sm:inline">{shortRelativeTime(issue.updated_at)}</span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
        <span className="rounded bg-zinc-800/60 px-1.5 py-0.5">{issue.status}</span>
        {Icon ? (
          <span className="inline-flex items-center gap-1">
            <Icon className="h-3 w-3" /> {assignee}
          </span>
        ) : (
          <span className="italic">{assignee}</span>
        )}
      </div>
    </li>
  )
}
