/**
 * /org — org-chart orchestration.
 *
 * Server component. Lists agent_roles + assigned agent slugs as a vertical
 * hierarchy. Empty state offers a "Seed default roles" CTA (CEO/CTO/Engineer/
 * Designer) so the operator can iterate from a sensible default rather than
 * building from scratch.
 *
 * See: supabase/migrations/057_agent_roles.sql
 *      lib/org/roles.ts
 *      components/org/OrgChart.tsx
 *      task_plan-platform-expansion.md (Task C)
 */

import { resolveUserIdSafe } from '@/lib/auth/resolve-user'
import { redirect } from 'next/navigation'
import { getRoleTree } from '@/lib/org/roles'
import OrgChart from '@/components/org/OrgChart'
import { Network } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ business?: string }>
}

export default async function OrgChartPage({ searchParams }: PageProps) {
  const userId = await resolveUserIdSafe()
  if (!userId) redirect('/')

  const params       = await searchParams
  const businessSlug = (params.business || '').trim() || null
  const tree         = await getRoleTree({ businessSlug })

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6 flex items-center gap-3">
        <Network className="h-6 w-6 text-zinc-400" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Org Chart</h1>
          <p className="text-sm text-zinc-400">
            {businessSlug
              ? `Roles scoped to "${businessSlug}".`
              : 'Platform-level roles. Append ?business=<slug> to see per-business roles.'}
          </p>
        </div>
      </header>

      <OrgChart tree={tree} businessSlug={businessSlug} />
    </div>
  )
}
