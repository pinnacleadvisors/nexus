'use client'

/**
 * AgentCard — one card per managed agent on the Agentdex page.
 *
 * Header   = icon, name, model badge (with arrow when a recommendation differs)
 * Body     = description, skills chips (tools[]), env-vars badge, env / transferable
 * Footer   = "View spec" expand + "Recommend model" button + model dropdown
 *
 * Visual contract matches AccountList / AiProviderCard — same liquid-glass
 * gradients, same chip pills.
 */

import { useState } from 'react'
import {
  ChevronDown, ChevronRight, Cpu, Sparkles, Lightbulb, Loader2,
  ExternalLink, AlertCircle, CheckCircle2,
} from 'lucide-react'
import type { AgentDefinition } from '@/lib/types'
import type { ModelDefinition, ModelRecommendation } from '@/lib/models/types'

export interface AgentCardProps {
  agent: AgentDefinition
  /** All catalog models available given currently-connected providers. */
  availableModels: ModelDefinition[]
  /** Latest recommendation, if any (lives in parent state). */
  recommendation: ModelRecommendation | null
  /** True when a recommend call is in-flight for this agent. */
  recommendBusy: boolean
  /** True when a model-save call is in-flight for this agent. */
  saveBusy: boolean
  onRecommend:  () => void
  onChangeModel: (modelId: string) => void
}

export default function AgentCard(props: AgentCardProps) {
  const { agent, availableModels, recommendation, recommendBusy, saveBusy, onRecommend, onChangeModel } = props
  const [expanded, setExpanded] = useState(false)
  const currentModelDef = availableModels.find(m => m.id === agent.model) ?? availableModels[0]
  const recommendedModel = recommendation && availableModels.find(m => m.id === recommendation.model)
  const recommendDiffers = recommendation && recommendation.model !== agent.model

  return (
    <div
      className="p-4 flex flex-col gap-3"
      style={{
        background:           'linear-gradient(135deg, rgba(108,99,255,0.06), rgba(255,255,255,0.02))',
        backdropFilter:       'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border:               '1px solid rgba(255,255,255,0.10)',
        borderRadius:         '16px',
        boxShadow:            '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 24px 48px -24px rgba(0,0,0,0.5)',
      }}
    >
      <Header agent={agent} currentModel={currentModelDef} recommendedModel={recommendedModel ?? null} />

      <p className="text-[12px] leading-relaxed line-clamp-3" style={{ color: '#9090b0' }}>
        {agent.description}
      </p>

      <SkillsRow tools={agent.tools} envVars={agent.envVars} transferable={agent.transferable} />

      {recommendation && (
        <RecommendationBanner
          recommendation={recommendation}
          recommendedModel={recommendedModel ?? null}
          differs={!!recommendDiffers}
        />
      )}

      <ModelPickerRow
        agent={agent}
        availableModels={availableModels}
        recommendation={recommendation}
        recommendBusy={recommendBusy}
        saveBusy={saveBusy}
        onRecommend={onRecommend}
        onChangeModel={onChangeModel}
      />

      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1.5 text-[11px] self-start"
        style={{ color: '#a8a3ff' }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{expanded ? 'Hide spec preview' : 'View spec preview'}</span>
        {agent.sourcePath && <span className="font-mono text-[9px]" style={{ color: '#55556a' }}>{agent.sourcePath}</span>}
      </button>

      {expanded && <SpecPreview agent={agent} />}
    </div>
  )
}

function Header({ agent, currentModel, recommendedModel }: {
  agent: AgentDefinition
  currentModel?: ModelDefinition
  recommendedModel: ModelDefinition | null
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
        style={{
          background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.06))',
          border:     '1px solid rgba(108,99,255,0.20)',
          boxShadow:  '0 1px 0 0 rgba(255,255,255,0.06) inset',
        }}>
        <Sparkles size={18} style={{ color: '#a8a3ff' }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-sm font-medium truncate" style={{ color: '#e8e8f0' }}>{agent.name}</span>
          <span className="font-mono text-[9px]" style={{ color: '#55556a' }}>{agent.slug}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <ModelBadge label={currentModel?.name ?? agent.model} active />
          {recommendedModel && recommendedModel.id !== currentModel?.id && (
            <>
              <span style={{ color: '#55556a' }}>→</span>
              <ModelBadge label={recommendedModel.name} recommended />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ModelBadge({ label, active, recommended }: { label: string; active?: boolean; recommended?: boolean }) {
  const styles = recommended
    ? { bg: 'rgba(34,197,94,0.10)',  bd: 'rgba(34,197,94,0.22)',  fg: '#4ade80' }
    : active
      ? { bg: 'rgba(108,99,255,0.10)', bd: 'rgba(108,99,255,0.22)', fg: '#a8a3ff' }
      : { bg: 'rgba(255,255,255,0.04)', bd: 'rgba(255,255,255,0.08)', fg: '#9090b0' }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono"
      style={{ background: styles.bg, border: `1px solid ${styles.bd}`, color: styles.fg, borderRadius: '6px' }}>
      <Cpu size={9} />
      {label}
    </span>
  )
}

function SkillsRow({ tools, envVars, transferable }: { tools: string[]; envVars: string[]; transferable: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-[10px]">
      {tools.length > 0 && tools.map(t => (
        <span key={t} className="font-mono px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(108,99,255,0.08)', color: '#a8a3ff', border: '1px solid rgba(108,99,255,0.18)' }}>
          {t}
        </span>
      ))}
      {envVars.length > 0 && (
        <span className="font-mono px-1.5 py-0.5 rounded" title={envVars.join(', ')}
          style={{ background: 'rgba(255,255,255,0.04)', color: '#9090b0', border: '1px solid rgba(255,255,255,0.08)' }}>
          {envVars.length} env
        </span>
      )}
      {!transferable && (
        <span className="font-mono px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(251,191,36,0.10)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.20)' }}>
          claude-only
        </span>
      )}
    </div>
  )
}

function RecommendationBanner({ recommendation, recommendedModel, differs }: {
  recommendation: ModelRecommendation
  recommendedModel: ModelDefinition | null
  differs: boolean
}) {
  return (
    <div className="px-2.5 py-2 text-[11px] leading-snug"
      style={{
        background:   differs ? 'rgba(34,197,94,0.06)' : 'rgba(108,99,255,0.06)',
        border:       differs ? '1px solid rgba(34,197,94,0.20)' : '1px solid rgba(108,99,255,0.20)',
        borderRadius: '10px',
        color:        '#c0c0d0',
      }}>
      <div className="flex items-start gap-1.5">
        <Lightbulb size={11} style={{ color: differs ? '#4ade80' : '#a8a3ff', marginTop: 2 }} />
        <div className="flex-1">
          <span style={{ color: '#e8e8f0' }}>
            {differs ? `Recommend ${recommendedModel?.name ?? recommendation.model}` : 'Already optimal'}
          </span>
          <span style={{ color: '#9090b0' }}> · {recommendation.rationale}</span>
        </div>
      </div>
    </div>
  )
}

function ModelPickerRow({ agent, availableModels, recommendation, recommendBusy, saveBusy, onRecommend, onChangeModel }: {
  agent: AgentDefinition
  availableModels: ModelDefinition[]
  recommendation: ModelRecommendation | null
  recommendBusy: boolean
  saveBusy: boolean
  onRecommend: () => void
  onChangeModel: (modelId: string) => void
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={onRecommend}
        disabled={recommendBusy}
        className="text-[11px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium disabled:opacity-50"
        style={{
          background:   'linear-gradient(135deg, rgba(108,99,255,0.25), rgba(108,99,255,0.06))',
          border:       '1px solid rgba(108,99,255,0.30)',
          color:        '#e8e8f0',
        }}
      >
        {recommendBusy ? <Loader2 size={11} className="animate-spin" /> : <Lightbulb size={11} />}
        {recommendation ? 'Re-recommend' : 'Recommend model'}
      </button>
      <select
        value={agent.model}
        disabled={saveBusy}
        onChange={e => onChangeModel(e.target.value)}
        className="text-[11px] px-2 py-1.5 rounded-lg font-mono disabled:opacity-50"
        style={{ background: 'rgba(5,5,16,0.55)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8e8f0' }}
      >
        {availableModels.length === 0 && <option value={agent.model}>{agent.model} (no providers connected)</option>}
        {availableModels.map(m => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
      {saveBusy && <Loader2 size={11} className="animate-spin" style={{ color: '#9090b0' }} />}
    </div>
  )
}

function SpecPreview({ agent }: { agent: AgentDefinition }) {
  const preview = agent.systemPrompt.split('\n').slice(0, 20).join('\n')
  return (
    <pre className="overflow-x-auto rounded-lg p-2.5 text-[10px] leading-relaxed font-mono"
      style={{
        background: 'rgba(0,0,0,0.30)',
        border:     '1px solid rgba(255,255,255,0.06)',
        color:      '#9090b0',
        maxHeight:  '220px',
      }}>
      {preview}
      {agent.systemPrompt.split('\n').length > 20 && <span style={{ color: '#55556a' }}>{'\n... (truncated)'}</span>}
    </pre>
  )
}
