/**
 * /businesses/new — entry point for the create_business chat consultation.
 *
 * Welcome / scoping page. The actual conversation happens in platform-copilot
 * chat (which delegates to .claude/agents/create-business.md). This page:
 *   1. Sets expectations — what questions will be asked
 *   2. Surfaces the provisioning steps that will eventually require approval
 *   3. Links to /manage-platform with a prefilled prompt that kicks the
 *      consultation off
 *
 * Phase 2 Task A — replaces what was previously `/idea`.
 */

import Link from 'next/link'
import { Bot, Sparkles, ShieldCheck, Database, Cloud, Plug, Globe2 } from 'lucide-react'

const QUESTIONS = [
  'What does this business do, in one sentence?',
  'Who is the target customer? (specific persona)',
  'How does it make money? (subscription / one-off / affiliate / ads)',
  'Brand voice + tone — 2-3 reference brands you want to feel like',
  'KPI targets in 90 days (sign-ups, MRR, content shipped, whatever you measure)',
  'Which platforms to connect day-one (Stripe, Shopify, ConvertKit, Twitter, …)',
  'Slug + display name + (optional) custom domain',
] as const

const PROVISIONING_STEPS: Array<{ icon: typeof Database; label: string; risk: 'low' | 'medium'; detail: string }> = [
  { icon: Database, label: 'business_operators row',  risk: 'low',    detail: 'Additive Supabase row; deletable via Settings → Businesses.' },
  { icon: Sparkles, label: 'MCP manifest resolution', risk: 'low',    detail: 'Read-only — looks up which MCPs your niche needs.' },
  { icon: Cloud,    label: 'Coolify Docker app',      risk: 'medium', detail: 'Creates infrastructure on KVM4. Reversible via deleteApp. Defaults to STAGED — operator clicks Start in Coolify after review.' },
  { icon: Globe2,   label: 'DNS + Cloudflare Tunnel',  risk: 'medium', detail: 'Adds <slug>.coolifycloudtunnel.uk + tunnel ingress entry. Reversible via tunnel migration script.' },
  { icon: Plug,     label: 'Composio connector seeds', risk: 'low',    detail: 'Generates OAuth-start URLs you click through. Each connector lands as one connected_accounts row scoped to this business.' },
]

// Prefilled prompt the platform-copilot chat picks up from `?prompt=` and
// uses to seed the conversation. URL-encoded; decoded server-side.
const PROMPT = encodeURIComponent(
  'I want to create a new business. Please invoke the create-business agent and walk me through the consultation.',
)

export default function NewBusinessPage() {
  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6 flex items-start gap-3">
        <div className="rounded-2xl bg-violet-500/10 p-3">
          <Bot className="h-6 w-6 text-violet-300" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New business — consultation</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            A chat-driven flow scopes the business, then provisions the supporting infrastructure (Supabase row, Coolify container, DNS, connectors) — each piece individually approved.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-zinc-300">
            <Sparkles className="h-4 w-4 text-violet-400" /> The consultation
          </h2>
          <p className="mb-3 text-xs text-zinc-500">7 questions, ~5 minutes. Skip anything that doesn&apos;t apply.</p>
          <ol className="space-y-2 text-sm">
            {QUESTIONS.map((q, i) => (
              <li key={i} className="flex items-start gap-3 text-zinc-300">
                <span className="mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-zinc-800 font-mono text-[10px] text-zinc-400">
                  {i + 1}
                </span>
                <span>{q}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-zinc-300">
            <ShieldCheck className="h-4 w-4 text-emerald-400" /> What will be provisioned (each requires APPROVAL)
          </h2>
          <ul className="space-y-3">
            {PROVISIONING_STEPS.map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <s.icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-zinc-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-zinc-200">{s.label}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                      s.risk === 'medium'
                        ? 'bg-amber-500/10 text-amber-300'
                        : 'bg-emerald-500/10 text-emerald-300'
                    }`}>
                      {s.risk}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">{s.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-[11px] text-zinc-500">
            <strong className="text-zinc-300">Default = staged.</strong> The Coolify container is created but NOT started — you click Start in the Coolify dashboard after reviewing the env injection. Switch to auto-start by setting <code className="rounded bg-zinc-800/60 px-1 font-mono">CREATE_BUSINESS_AUTO_START=1</code> in Doppler when you trust the flow.
          </p>
        </section>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          href={`/manage-platform?prompt=${PROMPT}`}
          className="inline-flex items-center gap-2 rounded-xl border border-violet-700/40 bg-violet-500/10 px-4 py-2.5 text-sm font-medium text-violet-100 transition hover:border-violet-600 hover:bg-violet-500/20"
        >
          <Bot className="h-4 w-4" /> Start consultation in chat
        </Link>
        <Link href="/businesses" className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Back to businesses
        </Link>
      </div>

      <p className="mt-6 max-w-3xl text-xs text-zinc-500">
        The consultation runs inside platform-copilot chat at <code className="rounded bg-zinc-800/60 px-1 font-mono">/manage-platform</code>. The chat agent delegates to the <code className="rounded bg-zinc-800/60 px-1 font-mono">create-business</code> agent (see <Link className="underline" href="/agents/create-business">spec</Link>) which gathers the brief then emits one <code className="rounded bg-zinc-800/60 px-1 font-mono">approval-request</code> block summarising the planned provisioning. Type <code className="rounded bg-zinc-800/60 px-1 font-mono">APPROVAL [n]: approve all</code> (or list specific item ids) to fire the mutating steps.
      </p>
    </div>
  )
}
