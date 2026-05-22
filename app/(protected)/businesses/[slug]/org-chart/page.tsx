/**
 * /businesses/[slug]/org-chart — visual hierarchy view.
 *
 * Two-level tree, rendered in pure CSS/HTML (no react-flow dependency). When
 * an agents table lands in a future phase, swap this for an agent-hierarchy
 * tree; the same OrgNode component should be reusable.
 *
 * Top level:    the company itself (business_operators row)
 * Second level: MCPs / tools resolved from lib/businesses/mcp-manifest.ts
 *               AND sub-companies (business_operators where parent_org_id = slug)
 *
 * Browser-test pending.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase'
import { resolveManifest } from '@/lib/businesses/mcp-manifest'
import { ArrowLeft, Building2, Wrench, Network } from 'lucide-react'

interface BusinessRow {
  slug:    string
  name:    string
  niche:   string
  status:  string
  mission: string | null
}

async function fetchData(slug: string): Promise<{
  business: BusinessRow | null
  children: BusinessRow[]
}> {
  const db = createServerClient()
  if (!db) return { business: null, children: [] }

  interface AnyChain extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
    select: (cols: string) => AnyChain
    eq:     (col: string, val: string) => AnyChain
    order:  (col: string, opts: { ascending: boolean }) => AnyChain
    maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>
  }
  const anyDb = db as unknown as { from: (t: string) => AnyChain }

  const [bizRes, childRes] = await Promise.all([
    anyDb.from('business_operators')
      .select('slug,name,niche,status,mission')
      .eq('slug', slug)
      .maybeSingle(),
    anyDb.from('business_operators')
      .select('slug,name,niche,status,mission')
      .eq('parent_org_id', slug)
      .order('name', { ascending: true }),
  ])

  return {
    business: (bizRes.data ?? null) as BusinessRow | null,
    children: ((childRes.data ?? []) as BusinessRow[]) || [],
  }
}

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function OrgChartPage({ params }: PageProps) {
  const { slug } = await params
  const { business, children } = await fetchData(slug)
  if (!business) notFound()

  const manifest = resolveManifest({ niche: business.niche })

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <Link href={`/businesses/${slug}`} className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200">
        <ArrowLeft className="h-4 w-4" /> Company overview
      </Link>

      <header className="mb-6 flex items-center gap-3">
        <Network className="h-6 w-6 text-zinc-400" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Org chart — {business.name}</h1>
          <p className="text-sm text-zinc-400">
            {manifest.mcps.length} tools · {children.length} sub-{children.length === 1 ? 'company' : 'companies'}
          </p>
        </div>
      </header>

      <div className="space-y-8">
        {/* Top: the company card itself */}
        <div className="flex justify-center">
          <CompanyCard business={business} primary />
        </div>

        {/* Connector lines + tools */}
        {manifest.mcps.length > 0 && (
          <section>
            <div className="mb-4 flex items-center justify-center">
              <div className="h-6 w-px bg-zinc-700" />
            </div>
            <h2 className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-zinc-500">
              Tools / MCP roster
            </h2>
            <div className="mx-auto grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {manifest.mcps.map(mcp => (
                <div key={mcp.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 text-center">
                  <Wrench className="mx-auto mb-2 h-4 w-4 text-zinc-500" />
                  <p className="truncate text-sm text-zinc-200">{mcp.name}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">{mcp.id}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Sub-companies (parent_org_id chain) */}
        {children.length > 0 && (
          <section>
            <div className="mb-4 flex items-center justify-center">
              <div className="h-6 w-px bg-zinc-700" />
            </div>
            <h2 className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-zinc-500">
              Sub-companies
            </h2>
            <div className="mx-auto grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {children.map(c => <CompanyCard key={c.slug} business={c} />)}
            </div>
          </section>
        )}

        <p className="mt-8 text-center text-xs text-zinc-600">
          Agent-level hierarchy will land when the <code className="rounded bg-zinc-800/60 px-1">agents</code> table is added (deferred from Phase 2).
        </p>
      </div>
    </div>
  )
}

function CompanyCard({ business, primary }: { business: BusinessRow; primary?: boolean }) {
  return (
    <Link
      href={`/businesses/${business.slug}`}
      className={
        'block rounded-xl border bg-zinc-900/40 p-4 transition hover:bg-zinc-900/60 ' +
        (primary
          ? 'w-full max-w-md border-zinc-700 bg-zinc-900/70 shadow-lg shadow-violet-500/5'
          : 'border-zinc-800')
      }
    >
      <div className="flex items-center gap-2">
        <Building2 className={primary ? 'h-5 w-5 text-violet-400' : 'h-4 w-4 text-zinc-500'} />
        <h3 className={primary ? 'text-lg font-medium tracking-tight' : 'text-sm font-medium'}>{business.name}</h3>
      </div>
      <p className="mt-1 text-xs text-zinc-500">{business.niche}</p>
      {primary && business.mission && (
        <p className="mt-2 line-clamp-2 text-sm text-zinc-400">{business.mission}</p>
      )}
    </Link>
  )
}
