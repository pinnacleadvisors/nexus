/**
 * /agents/[slug] — per-agent profiling.
 *
 * Three sections:
 *   - Header: name, description, model, transferable badge
 *   - Capabilities: tools list + required env (env names only, never values)
 *   - Recent runs: last 20 from run_events filtered by event_type prefix
 *     matching the agent slug — best-effort heuristic
 *   - Heartbeat timeline: HeartbeatTimeline component
 *
 * Server component. Body text is truncated to 1000 chars to avoid leaking
 * potentially sensitive system-prompt content; full file path is shown so
 * the operator can grep it directly when they need the full spec.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAgent } from '@/lib/agents/registry'
import { createServerClient } from '@/lib/supabase'
import HeartbeatTimeline from '@/components/heartbeat/HeartbeatTimeline'
import { ArrowLeft, Bot, Sparkles, Shield, Wrench, Lock, ExternalLink } from 'lucide-react'

const RECENT_RUN_LIMIT = 20
const BODY_PREVIEW_LEN = 1000

interface AnyChain extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  select: (cols: string) => AnyChain
  eq:     (col: string, val: string) => AnyChain
  like:   (col: string, val: string) => AnyChain
  order:  (col: string, opts: { ascending: boolean }) => AnyChain
  limit:  (n: number) => AnyChain
}

interface RunEventRow {
  id:            string
  run_id:        string | null
  business_slug: string | null
  event_type:    string
  payload:       Record<string, unknown> | null
  created_at:    string
}

async function fetchRecentRuns(slug: string): Promise<RunEventRow[]> {
  const db = createServerClient()
  if (!db) return []
  const anyDb = db as unknown as { from: (t: string) => AnyChain }
  // Heuristic: any run_event whose event_type or payload references the slug.
  // Future: a dedicated agent_runs view will be cleaner.
  const res = await anyDb.from('run_events')
    .select('id,run_id,business_slug,event_type,payload,created_at')
    .like('event_type', `%${slug}%`)
    .order('created_at', { ascending: false })
    .limit(RECENT_RUN_LIMIT)
  return ((res.data ?? []) as RunEventRow[]) || []
}

function shortRelative(iso: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60)    return `${sec}s`
  if (sec < 3600)  return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function AgentDetailPage({ params }: PageProps) {
  const { slug } = await params
  const [agent, recentRuns] = await Promise.all([getAgent(slug), fetchRecentRuns(slug)])
  if (!agent) notFound()

  const bodyPreview = agent.body.slice(0, BODY_PREVIEW_LEN)
  const truncated   = agent.body.length > BODY_PREVIEW_LEN

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <Link href="/agents" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200">
        <ArrowLeft className="h-4 w-4" /> All agents
      </Link>

      <header className="mb-6">
        <div className="flex items-center gap-2">
          <Bot className="h-6 w-6 text-zinc-400" />
          <h1 className="text-2xl font-semibold tracking-tight">{agent.slug}</h1>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">{agent.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {agent.model && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2.5 py-1 text-violet-300">
              <Sparkles className="h-3 w-3" /> {agent.model}
            </span>
          )}
          {agent.transferable && (
            <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/10 px-2.5 py-1 text-cyan-300">
              <Shield className="h-3 w-3" /> portable
            </span>
          )}
          <a
            href={`https://github.com/pinnacleadvisors/nexus/blob/main/${agent.sourcePath}`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 rounded-full bg-zinc-800/60 px-2.5 py-1 font-mono text-zinc-400 hover:text-zinc-200"
          >
            {agent.sourcePath} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {/* Capabilities */}
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
            <div className="mb-3 flex items-center gap-2">
              <Wrench className="h-4 w-4 text-zinc-400" />
              <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-300">Capabilities</h2>
            </div>
            <h3 className="text-xs uppercase tracking-wide text-zinc-500">Tools ({agent.tools.length})</h3>
            {agent.tools.length === 0 ? (
              <p className="mt-2 text-sm italic text-zinc-500">No tools declared (inherits parent).</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {agent.tools.map(t => (
                  <li key={t}>
                    <span className="inline-flex rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-0.5 font-mono text-xs text-zinc-300">{t}</span>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="mt-4 text-xs uppercase tracking-wide text-zinc-500">Env required ({agent.env.length})</h3>
            {agent.env.length === 0 ? (
              <p className="mt-2 text-sm italic text-zinc-500">No additional env vars beyond gateway defaults.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {agent.env.map(e => (
                  <li key={e}>
                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-700/40 bg-amber-500/5 px-2 py-0.5 font-mono text-xs text-amber-300">
                      <Lock className="h-2.5 w-2.5" /> {e}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Spec body preview */}
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-300">Spec preview</h2>
              {truncated && (
                <span className="text-[10px] font-mono text-zinc-500">first {BODY_PREVIEW_LEN} chars</span>
              )}
            </div>
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-400">{bodyPreview}</pre>
            {truncated && (
              <a
                href={`https://github.com/pinnacleadvisors/nexus/blob/main/${agent.sourcePath}`}
                target="_blank"
                rel="noopener"
                className="mt-3 inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300"
              >
                Read full spec <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </section>

          {/* Heartbeat timeline */}
          <HeartbeatTimeline events={recentRuns} agentSlug={agent.slug} />
        </div>

        <aside>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h3 className="mb-3 text-sm font-medium tracking-tight">Recent runs ({recentRuns.length})</h3>
            {recentRuns.length === 0 ? (
              <p className="text-xs italic text-zinc-500">No recent runs found.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {recentRuns.slice(0, 10).map(r => (
                  <li key={r.id} className="border-b border-zinc-800/60 pb-2 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-zinc-300">{r.event_type}</span>
                      <time className="flex-shrink-0 text-zinc-600" dateTime={r.created_at}>{shortRelative(r.created_at)}</time>
                    </div>
                    {r.business_slug && (
                      <Link href={`/businesses/${r.business_slug}`} className="text-zinc-500 hover:text-zinc-300">
                        {r.business_slug}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
