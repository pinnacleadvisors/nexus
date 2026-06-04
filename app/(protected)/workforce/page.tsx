'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2, Users, Building2, Activity, RefreshCw, ExternalLink } from 'lucide-react'

type Agent = { id: string; name: string }
type Company = { id: string; name: string }
type Run = { id: string; status?: string; agentName?: string; createdAt?: string }

const CARD = { backgroundColor: '#0d0d14', borderColor: '#24243e' } as const

async function pc<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`/api/workforce/${path}`, { cache: 'no-store' })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

function asArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[]
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    for (const k of ['data', 'companies', 'agents', 'runs', 'items']) if (Array.isArray(o[k])) return o[k] as T[]
  }
  return []
}

export default function WorkforcePage() {
  const [tab, setTab] = useState<'overview' | 'full'>('overview')
  const [loading, setLoading] = useState(true)
  const [companies, setCompanies] = useState<Company[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [unreachable, setUnreachable] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const cos = asArray<Company>(await pc<unknown>('companies'))
    setCompanies(cos)
    if (cos.length === 0) setUnreachable(true)
    const first = cos[0]
    if (first) {
      setAgents(asArray<Agent>(await pc<unknown>(`companies/${first.id}/agents`)))
      setRuns(asArray<Run>(await pc<unknown>(`companies/${first.id}/heartbeat-runs?limit=12`)))
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="p-4 sm:p-6 min-h-full" style={{ backgroundColor: '#050508' }}>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-lg font-semibold" style={{ color: '#e8e8f0' }}>Workforce</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => void load()} className="text-xs flex items-center gap-1 px-2 py-1 rounded-md border" style={CARD}>
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
            <a href="/api/workforce/ui/" target="_blank" rel="noreferrer" className="text-xs flex items-center gap-1 px-2 py-1 rounded-md border" style={CARD}>
              <ExternalLink className="w-3 h-3" /> Open Paperclip
            </a>
          </div>
        </div>
        <p className="text-xs mb-4" style={{ color: '#8a8aa0' }}>
          Paperclip orchestration, embedded via Nexus (Clerk-authed; Paperclip stays loopback-only).
        </p>

        <div className="flex gap-1 mb-4">
          {(['overview', 'full'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className="text-xs px-3 py-1.5 rounded-md border capitalize"
              style={{ ...CARD, color: tab === t ? '#e8e8f0' : '#8a8aa0', borderColor: tab === t ? '#4f46e5' : '#24243e' }}>
              {t === 'full' ? 'Full Paperclip' : 'Overview'}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          loading ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: '#8a8aa0' }}>
              <Loader2 className="w-4 h-4 animate-spin" /> Loading workforce…
            </div>
          ) : unreachable ? (
            <div className="p-4 rounded-xl border text-sm" style={CARD}>
              <p style={{ color: '#e8e8f0' }}>Paperclip not reachable.</p>
              <p className="text-xs mt-1" style={{ color: '#8a8aa0' }}>
                Ensure the <code>com.workforce.paperclip</code> launchd agent is running on the Mac (<code>:3100</code>).
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <Panel icon={<Building2 className="w-4 h-4" />} title={`Companies (${companies.length})`}>
                {companies.map((c) => <Row key={c.id} text={c.name} />)}
              </Panel>
              <Panel icon={<Users className="w-4 h-4" />} title={`Agents (${agents.length})`}>
                {agents.map((a) => <Row key={a.id} text={a.name} />)}
              </Panel>
              <Panel icon={<Activity className="w-4 h-4" />} title="Recent heartbeats">
                {runs.length === 0 && <Row text="No runs yet" muted />}
                {runs.map((r) => <Row key={r.id} text={`${r.agentName ?? 'agent'} · ${r.status ?? '—'}`} />)}
              </Panel>
            </div>
          )
        )}

        {tab === 'full' && (
          <div className="rounded-xl border overflow-hidden" style={{ ...CARD, height: '78vh' }}>
            <iframe src="/api/workforce/ui/" title="Paperclip" className="w-full h-full" style={{ border: 0 }} />
          </div>
        )}
      </div>
    </div>
  )
}

function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 rounded-xl border" style={CARD}>
      <h2 className="text-sm font-semibold mb-2 flex items-center gap-2" style={{ color: '#e8e8f0' }}>{icon}{title}</h2>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Row({ text, muted }: { text: string; muted?: boolean }) {
  return <div className="text-xs py-1 px-2 rounded-md" style={{ color: muted ? '#6a6a80' : '#c8c8d8', backgroundColor: '#08080c' }}>{text}</div>
}
