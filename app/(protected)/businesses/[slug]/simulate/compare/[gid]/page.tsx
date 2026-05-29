/**
 * /businesses/:slug/simulate/compare/:gid — A/B comparison view.
 *
 * Server page validates the group belongs to the operator, then hands
 * off to the client ABComparisonView which polls + renders the live
 * comparison table.
 */

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { resolveUserIdSafe } from '@/lib/auth/resolve-user'
import { createServerClient } from '@/lib/supabase'
import ABComparisonView from '@/components/simulations/ABComparisonView'
import { ArrowLeft, Zap } from 'lucide-react'

export default async function CompareGroupPage({
  params,
}: {
  params: Promise<{ slug: string; gid: string }>
}) {
  const { slug, gid } = await params
  if (!/^[0-9a-f-]{36}$/i.test(gid)) notFound()

  const userId = await resolveUserIdSafe()
  if (!userId) redirect('/')

  const db = createServerClient()
  if (!db) notFound()

  // Ownership pre-check — confirms at least one row exists in the group for this user
  const ownRes = await (db.from('simulation_runs' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { limit: (n: number) => Promise<{ data: Array<{ id: string }> | null }> } } } }
  }).select('id').eq('compare_group_id', gid).eq('user_id', userId).eq('business_slug', slug).limit(1)
  if (!ownRes.data || ownRes.data.length === 0) notFound()

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link
        href={`/businesses/${slug}/simulate`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 transition hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" /> Back to console
      </Link>
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-100">
          <Zap className="h-6 w-6 text-violet-400" />
          A/B comparison
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Same seed, different approver policies. Like backtesting multiple trading strategies on the
          same historical bars — only the policy varies, the chaos is identical.
        </p>
      </header>
      <ABComparisonView groupId={gid} slug={slug} />
    </main>
  )
}
