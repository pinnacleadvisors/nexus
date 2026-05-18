'use client'

/**
 * AgentList — body for /settings/agents (the Agentdex).
 *
 * - Loads managed agents from /api/agents/managed (filesystem-backed)
 * - Loads connected AI providers via /api/connected-accounts + /api/gateway-status
 * - Renders one AgentCard per agent with skills, model picker, "Recommend"
 * - Top bar: "Recommend models for all" — fires N parallel /api/models/recommend
 *
 * Model overrides persist via POST /api/agents (upserts agent_library.model).
 * The markdown file remains canonical; the table is a projection that lets
 * runtime code read the picked model without reparsing markdown every call.
 */

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { AgentDefinition } from '@/lib/types'
import type { ModelRecommendation, AiProviderKey } from '@/lib/models/types'
import { MODEL_CATALOG } from '@/lib/models/catalog'
import AgentCard from './AgentCard'
import { AgentdexHeader, AgentdexBanner } from './AgentListHeader'

interface ConnectedAccount { platform: string; status: string }
interface GatewayStatus { provider: 'gateway' | 'openclaw' | 'api' | 'none'; gatewayHealthy: boolean }

const AI_PLATFORMS = ['anthropic','openai','google','xai','deepseek','meta','mistral','replicate'] as const

export default function AgentList() {
  const [agents, setAgents]               = useState<AgentDefinition[]>([])
  const [providers, setProviders]         = useState<AiProviderKey[]>([])
  const [recommendations, setRecs]        = useState<Record<string, ModelRecommendation>>({})
  const [busyRecommend, setBusyRec]       = useState<Record<string, boolean>>({})
  const [busySave, setBusySave]           = useState<Record<string, boolean>>({})
  const [loading, setLoading]             = useState(true)
  const [globalBusy, setGlobalBusy]       = useState(false)
  const [err, setErr]                     = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [agentsRes, gwRes, accRes] = await Promise.all([
        fetch('/api/agents/managed'),
        fetch('/api/gateway-status'),
        fetch('/api/connected-accounts'),
      ])
      if (agentsRes.ok) {
        const j = (await agentsRes.json()) as { agents: AgentDefinition[] }
        setAgents(j.agents)
      }
      const connected = new Set<AiProviderKey>()
      if (gwRes.ok) {
        const gw = (await gwRes.json()) as GatewayStatus
        if (gw.provider === 'gateway' && gw.gatewayHealthy) connected.add('anthropic')
        if (gw.provider === 'api') connected.add('anthropic')
        if (gw.provider === 'openclaw') connected.add('anthropic')
      }
      if (accRes.ok) {
        const j = (await accRes.json()) as { accounts: ConnectedAccount[] }
        for (const a of j.accounts ?? []) {
          if (a.status !== 'active') continue
          if ((AI_PLATFORMS as readonly string[]).includes(a.platform)) {
            connected.add(a.platform as AiProviderKey)
          }
        }
      }
      setProviders(Array.from(connected))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to load agents')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const availableModels = useMemo(
    () => MODEL_CATALOG.filter(m => providers.includes(m.provider)),
    [providers],
  )

  async function recommendOne(agent: AgentDefinition): Promise<ModelRecommendation | null> {
    setBusyRec(p => ({ ...p, [agent.slug]: true }))
    try {
      const res = await fetch('/api/models/recommend', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ agent }),
      })
      const j = (await res.json()) as { ok?: boolean; error?: string; recommendation?: ModelRecommendation }
      if (!j.ok || !j.recommendation) throw new Error(j.error ?? 'recommendation failed')
      setRecs(p => ({ ...p, [agent.slug]: j.recommendation! }))
      return j.recommendation
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'recommendation failed')
      return null
    } finally {
      setBusyRec(p => ({ ...p, [agent.slug]: false }))
    }
  }

  async function recommendAll() {
    setGlobalBusy(true); setErr(null)
    try {
      // 3-at-a-time concurrency caps gateway worker contention. Per-agent
      // errors are absorbed — partial success is fine.
      const queue = [...agents]
      const workers = Array.from({ length: 3 }, async () => {
        while (queue.length > 0) {
          const a = queue.shift(); if (!a) return
          await recommendOne(a)
        }
      })
      await Promise.all(workers)
    } finally {
      setGlobalBusy(false)
    }
  }

  async function changeModel(agent: AgentDefinition, modelId: string) {
    setBusySave(p => ({ ...p, [agent.slug]: true }))
    try {
      const res = await fetch('/api/agents', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ ...agent, model: modelId }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `save failed: ${res.status}`)
      }
      setAgents(prev => prev.map(a => a.slug === agent.slug ? { ...a, model: modelId } : a))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed')
    } finally {
      setBusySave(p => ({ ...p, [agent.slug]: false }))
    }
  }

  const noProviders = providers.length === 0
  const skillsCount = countSkills(agents)

  return (
    <div className="space-y-4">
      <AgentdexHeader
        agentCount={agents.length}
        skillsCount={skillsCount}
        providers={providers}
        availableCount={availableModels.length}
        busy={globalBusy}
        onRecommendAll={recommendAll}
      />

      {err && <AgentdexBanner kind="error" onDismiss={() => setErr(null)}>{err}</AgentdexBanner>}
      {noProviders && !loading && (
        <AgentdexBanner kind="warn">
          No AI providers connected. Visit{' '}
          <a className="underline" href="/settings?tab=ai">AI Providers</a> first.
        </AgentdexBanner>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm px-4 py-3"
          style={{
            color: '#9090b0',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '14px',
          }}>
          <Loader2 size={14} className="animate-spin" /> Loading agentdex…
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {agents.map(a => (
            <AgentCard
              key={a.slug}
              agent={a}
              availableModels={availableModels}
              recommendation={recommendations[a.slug] ?? null}
              recommendBusy={!!busyRecommend[a.slug]}
              saveBusy={!!busySave[a.slug]}
              onRecommend={() => void recommendOne(a)}
              onChangeModel={(m: string) => void changeModel(a, m)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function countSkills(agents: AgentDefinition[]): number {
  const set = new Set<string>()
  for (const a of agents) for (const t of a.tools) set.add(t)
  return set.size
}
