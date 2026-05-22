/**
 * /agents — index of every managed agent in .claude/agents/.
 *
 * Server-component read of the filesystem at request time. Operator sees
 * what platform-copilot, business-copilot, codex-operator etc. can do
 * without grepping the repo.
 */

import Link from 'next/link'
import { listAgents } from '@/lib/agents/registry'
import { Bot, Sparkles, Shield } from 'lucide-react'

export default async function AgentsIndexPage() {
  const agents = await listAgents()

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6 flex items-center gap-3">
        <Bot className="h-6 w-6 text-zinc-400" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="text-sm text-zinc-400">
            {agents.length} managed agent{agents.length === 1 ? '' : 's'}. Click any agent to inspect its tools, model, env, and recent runs.
          </p>
        </div>
      </header>

      {agents.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <p className="text-zinc-400">No agents found under <code className="rounded bg-zinc-800/60 px-1 text-xs">.claude/agents/</code>.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map(a => (
            <Link
              key={a.slug}
              href={`/agents/${a.slug}`}
              className="group rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 transition hover:border-zinc-700 hover:bg-zinc-900/60"
            >
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 flex-shrink-0 text-zinc-400" />
                <h2 className="truncate text-sm font-medium tracking-tight text-zinc-100">{a.slug}</h2>
              </div>
              {a.description && (
                <p className="mt-2 line-clamp-3 text-xs text-zinc-400">{a.description}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px]">
                {a.model && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-300">
                    <Sparkles className="h-2.5 w-2.5" /> {a.model}
                  </span>
                )}
                {a.transferable && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/10 px-2 py-0.5 text-cyan-300">
                    <Shield className="h-2.5 w-2.5" /> portable
                  </span>
                )}
                <span className="rounded-full bg-zinc-800/60 px-2 py-0.5 text-zinc-400 font-mono">
                  {a.tools.length} tool{a.tools.length === 1 ? '' : 's'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
