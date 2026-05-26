/**
 * /simulate/benchmarks — operator UI for managing simulation_benchmarks
 * (v2-D drift-alarm). Lists every benchmark, lets the operator:
 *   - toggle enabled on/off
 *   - reset baseline (forgive existing drift after an intentional change)
 *   - run now (manually trigger a benchmark outside the 06:00 cron)
 *   - tune drift threshold
 *   - create new benchmarks
 *   - delete benchmarks
 *
 * Server page fetches the row set; client component renders + handles
 * mutations.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import BenchmarksAdmin, { type BenchmarkRowView } from '@/components/simulations/BenchmarksAdmin'
import { ArrowLeft, Zap } from 'lucide-react'

interface SimBusiness {
  slug: string
  name: string
}

export default async function BenchmarksPage() {
  const { userId } = await auth()
  if (!userId) redirect('/')

  const db = createServerClient()
  if (!db) {
    return <main className="mx-auto max-w-5xl px-4 py-8 text-zinc-300">Supabase not configured.</main>
  }

  const benchRes = await (db.from('simulation_benchmarks' as never) as unknown as {
    select: (c: string) => { order: (c: string, o: { ascending: boolean }) => Promise<{ data: BenchmarkRowView[] | null }> }
  }).select('*').order('created_at', { ascending: false })
  const rows = benchRes.data ?? []

  const bizRes = await (db.from('business_operators' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => Promise<{ data: SimBusiness[] | null }> }
  }).select('slug, name').eq('simulation', 'true')
  const simBusinesses = bizRes.data ?? []

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 transition hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-100">
          <Zap className="h-6 w-6 text-violet-400" />
          Simulation benchmarks
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-400">
          Drift-alarm canaries for the hyperbolic chamber. Each benchmark re-runs a fixed-seed
          simulation every morning at 06:00 UTC and diffs the result against the stored baseline.
          When the drift exceeds threshold, you get a Slack alert — that&apos;s the signal that
          a recent code change broke the chaos harness.
        </p>
      </header>

      <BenchmarksAdmin initialRows={rows} simBusinesses={simBusinesses} />
    </main>
  )
}
