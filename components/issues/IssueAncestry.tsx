import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { Ancestry } from '@/lib/goals/ancestry'

interface Props {
  ancestry: Ancestry | null
}

/**
 * Breadcrumb ancestry display: company → ...parent goals → goal → ...parent
 * issues → this issue. Mirrors Paperclip's BreadcrumbBar.
 *
 * Empty when ancestry is null (e.g. migration 052 not applied or no parent).
 */
export default function IssueAncestry({ ancestry }: Props) {
  if (!ancestry) return null

  const crumbs: Array<{ label: string; href?: string; muted?: boolean }> = []
  crumbs.push({
    label: ancestry.business.name,
    href:  `/companies/${ancestry.business.slug}`,
  })

  // Parent goals — outermost first (reverse parent_goals order since they were
  // returned closest-first by the recursive CTE).
  for (let i = ancestry.parent_goals.length - 1; i >= 0; i--) {
    crumbs.push({ label: ancestry.parent_goals[i]!.title, muted: true })
  }

  if (ancestry.goal) {
    crumbs.push({ label: ancestry.goal.title })
  }

  for (let i = ancestry.parent_issues.length - 1; i >= 0; i--) {
    crumbs.push({ label: ancestry.parent_issues[i]!.title })
  }

  crumbs.push({ label: ancestry.issue.title, muted: false })

  return (
    <nav className="flex flex-wrap items-center gap-1 text-xs text-zinc-500" aria-label="Issue ancestry">
      {crumbs.map((c, idx) => {
        const isLast = idx === crumbs.length - 1
        const node = (
          <span className={isLast ? 'font-medium text-zinc-200' : c.muted ? 'text-zinc-600' : 'text-zinc-400'}>
            {c.label}
          </span>
        )
        return (
          <span key={`${idx}-${c.label}`} className="inline-flex items-center gap-1">
            {c.href ? <Link href={c.href} className="hover:text-zinc-300">{node}</Link> : node}
            {!isLast && <ChevronRight className="h-3 w-3 text-zinc-700" />}
          </span>
        )
      })}
    </nav>
  )
}
