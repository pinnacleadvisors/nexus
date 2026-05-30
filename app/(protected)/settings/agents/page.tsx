/**
 * /settings/agents — the Agentdex.
 *
 * One card per managed agent in `.claude/agents/*.md`. Operator can:
 *   - See which model each agent currently runs on
 *   - Click "Recommend model" to ask the LLM judge for the best fit given
 *     currently-connected providers + benchmark catalog
 *   - Override the model via dropdown (persists to agent_library.model)
 *   - "Recommend models for all" at the top fires a parallel scan
 *
 * Read order:
 *   - filesystem (/api/agents/managed) is canonical for the spec set
 *   - Supabase agent_library mirrors only the model override + audit fields
 */

import { Sparkles } from 'lucide-react'
import SettingsTabs from '@/components/settings/SettingsTabs'
import AgentList from '@/components/settings/AgentList'
import { DescribeIntentCard } from '@/components/settings/DescribeIntentCard'

export const dynamic = 'force-dynamic'

export default function AgentdexPage() {
  return (
    <div
      className="p-6 min-h-full"
      style={{
        backgroundColor: '#050508',
        backgroundImage:
          'radial-gradient(1200px 600px at 10% -10%, rgba(108,99,255,0.10), transparent 60%), ' +
          'radial-gradient(900px 500px at 100% 100%, rgba(108,99,255,0.06), transparent 60%)',
      }}
    >
      <div className="max-w-5xl mx-auto">
        {/* Page heading */}
        <div className="mb-5 flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
            style={{
              background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.06))',
              border:     '1px solid rgba(108,99,255,0.20)',
              boxShadow:  '0 1px 0 0 rgba(255,255,255,0.06) inset',
            }}
          >
            <Sparkles size={18} style={{ color: '#a8a3ff' }} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold" style={{ color: '#e8e8f0' }}>
              Agentdex
            </h1>
            <p className="text-sm mt-1 max-w-2xl" style={{ color: '#9090b0' }}>
              Every managed agent in this workspace. Pick a model per agent, or let the LLM judge recommend the best fit from the catalog using LiveBench / SWE-bench / MMMU snapshots.
            </p>
          </div>
        </div>

        <SettingsTabs activeTab="agents" />

        <div className="mt-4 mb-4">
          <DescribeIntentCard
            title="Create an agent"
            subtitle="Describe a role in plain English — we'll classify it and file it for the agent-generator."
            placeholder="e.g. an agent that drafts weekly LinkedIn posts from our blog"
            endpoint="/api/agents/describe"
          />
        </div>

        <AgentList />
      </div>
    </div>
  )
}
