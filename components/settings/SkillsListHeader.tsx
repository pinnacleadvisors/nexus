'use client'

/**
 * SkillsListHeader — Skills-tab analogue of AgentdexHeader. Shows the skill
 * tallies + model/provider counts and a "Recommend models for all" button that
 * mirrors the Agentdex affordance. Split into its own file to respect the
 * write-size discipline and keep SkillsList focused on row state.
 */

import { Loader2, Wand2, Sparkles } from 'lucide-react'

export function SkillsListHeader({
  skillCount, verifiedCount, draftCount, providerCount, modelCount, busy, onRecommendAll,
}: {
  skillCount:    number
  verifiedCount: number
  draftCount:    number
  providerCount: number
  modelCount:    number
  busy:          boolean
  onRecommendAll: () => void
}) {
  return (
    <div
      className="relative p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3"
      style={{
        background:     'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
        backdropFilter: 'blur(28px) saturate(180%)',
        border:         '1px solid rgba(255,255,255,0.10)',
        borderRadius:   '14px',
        boxShadow:      '0 1px 0 0 rgba(255,255,255,0.04) inset',
      }}
    >
      <div className="flex items-center gap-2 shrink-0">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg, rgba(108,99,255,0.20), rgba(108,99,255,0.04))', border: '1px solid rgba(108,99,255,0.20)' }}
        >
          <Sparkles size={15} style={{ color: '#a8a3ff' }} />
        </div>
        <div>
          <p className="text-[11px] font-mono uppercase tracking-wider" style={{ color: '#9090b0' }}>Skills</p>
          <p className="text-xs" style={{ color: '#e8e8f0' }}>
            {skillCount} {skillCount === 1 ? 'skill' : 'skills'} ·{' '}
            <span style={{ color: '#4ade80' }}>{verifiedCount} verified</span>
            {draftCount > 0 && <> · <span style={{ color: '#fbbf24' }}>{draftCount} draft</span></>} ·{' '}
            <span style={{ color: '#a8a3ff' }}>{modelCount}</span> models across {providerCount}{' '}
            {providerCount === 1 ? 'provider' : 'providers'}
          </p>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onRecommendAll}
          disabled={busy || skillCount === 0 || providerCount === 0}
          className="text-[12px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
          style={{
            background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.10))',
            border:     '1px solid rgba(108,99,255,0.30)',
            color:      '#e8e8f0',
            boxShadow:  '0 1px 0 0 rgba(255,255,255,0.06) inset',
          }}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
          Recommend models for all
        </button>
      </div>
    </div>
  )
}
