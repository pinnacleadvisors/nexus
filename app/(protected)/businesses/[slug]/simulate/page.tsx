/**
 * /businesses/[slug]/simulate — hyperbolic-chamber console.
 *
 * Server component: validates the business is a sim, finds the latest run
 * (active or completed), hands off to the client SimulationConsole. If no
 * run exists, shows the start form.
 */

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import SimulationConsole, { type SimulationRunRow } from '@/components/simulations/SimulationConsole'
import { ArrowLeft, Zap } from 'lucide-react'

interface BusinessRow {
  slug:        string
  name:        string
  niche:       string
  simulation:  boolean | null
}

export default async function SimulatePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { userId } = await auth()
  if (!userId) redirect('/')

  const db = createServerClient()
  if (!db) notFound()

  const bizRes = await (db.from('business_operators' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: BusinessRow | null }> } }
  }).select('slug, name, niche, simulation').eq('slug', slug).maybeSingle()
  if (!bizRes.data) notFound()
  const biz = bizRes.data
  if (!biz.simulation) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Link href={`/businesses/${slug}`} className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-400 transition hover:text-zinc-200">
          <ArrowLeft className="h-4 w-4" /> Back to {biz.name}
        </Link>
        <div className="rounded-xl border border-amber-700/40 bg-amber-500/10 p-6 text-amber-200">
          <h2 className="mb-2 text-lg font-semibold">Not a simulation business</h2>
          <p className="text-sm">
            The hyperbolic chamber only runs on businesses flagged as simulations. Flip{' '}
            <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-xs">simulation = true</code>{' '}
            on this business if you want to test it here (it short-circuits real spend + money-moving verbs).
          </p>
        </div>
      </main>
    )
  }

  // Most-recent run (active OR completed) — UI picks how to render
  const runRes = await (db.from('simulation_runs' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: SimulationRunRow[] | null }> } } } }
  }).select('*').eq('business_slug', slug).eq('user_id', userId).order('created_at', { ascending: false }).limit(1)
  const latest = (runRes.data ?? [])[0] ?? null

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link
        href={`/businesses/${slug}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 transition hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" /> Back to {biz.name}
      </Link>
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-100">
          <Zap className="h-6 w-6 text-violet-400" />
          Hyperbolic chamber — {biz.name}
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Compress N business-days into a wallclock budget. Manual mode = approve each gate yourself,
          like clicking &quot;next bar&quot; in a trading replay. Auto-pilot = heuristic approver decides;
          you read stats at the end.
        </p>
      </header>

      <SimulationConsole slug={slug} initialRun={latest} />
    </main>
  )
}
