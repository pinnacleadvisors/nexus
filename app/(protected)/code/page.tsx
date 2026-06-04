import { Code2, ExternalLink, Inbox, CheckSquare, ShieldCheck } from 'lucide-react'
import CodeEmbed from '@/components/code/CodeEmbed'

// Phase 1 of the chat-engine replacement (ADR 013): surface claudecodeui (host
// Claude Code, substrate-registered) as the agent chat, and keep the Nexus
// governance views as the preserved "rail". claudecodeui has its own auth + is
// WebSocket-heavy, so it runs behind its own login + the Cloudflare tunnel
// (CODE_EMBED_URL); Nexus links/embeds it. See docs/runbooks/claudecodeui-setup.md.

const EMBED = process.env.CODE_EMBED_URL || 'https://code.coolifycloudtunnel.uk'
const CARD = { backgroundColor: '#0d0d14', borderColor: '#24243e' } as const

export default function CodePage() {
  return (
    <div className="p-4 sm:p-6 min-h-full" style={{ backgroundColor: '#050508' }}>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-lg font-semibold flex items-center gap-2" style={{ color: '#e8e8f0' }}>
            <Code2 className="w-5 h-5" /> Code
          </h1>
          <a href={EMBED} target="_blank" rel="noreferrer" className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-md border" style={CARD}>
            <ExternalLink className="w-3 h-3" /> Open claudecodeui
          </a>
        </div>
        <p className="text-xs mb-4" style={{ color: '#8a8aa0' }}>
          Claude Code chat (claudecodeui) — the OSS engine, with the Nexus MCP substrate (memory + connectors).
          Replaces the bespoke chat engine; the governance views below are preserved (ADR 013).
        </p>

        {/* Preserved governance rail — these survive the engine swap (DB-backed, standalone). */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <RailLink href="/inbox" icon={<Inbox className="w-4 h-4" />} title="Inbox" sub="Approvals · issues · tasks" />
          <RailLink href="/approvals" icon={<ShieldCheck className="w-4 h-4" />} title="Approvals" sub="Gate decisions" />
          <RailLink href="/board" icon={<CheckSquare className="w-4 h-4" />} title="Tasks / Pipeline" sub="Manual + background tasks" />
        </div>

        {/* Reachability-aware embed: shows claudecodeui when it's up, a graceful
            "not connected" panel (with retry) when it isn't. Cross-subdomain
            iframing also depends on its frame-ancestors + cookie policy — use
            "Open claudecodeui" if it loads blank. */}
        <CodeEmbed url={EMBED} />
      </div>
    </div>
  )
}

function RailLink({ href, icon, title, sub }: { href: string; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <a href={href} className="p-3 rounded-xl border block" style={CARD}>
      <div className="text-sm font-semibold flex items-center gap-2" style={{ color: '#e8e8f0' }}>{icon}{title}</div>
      <div className="text-xs mt-0.5" style={{ color: '#8a8aa0' }}>{sub}</div>
    </a>
  )
}
