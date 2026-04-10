'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Cpu, Shield, RefreshCw, CheckCircle2, XCircle,
  AlertTriangle, Lock, Wifi, WifiOff,
} from 'lucide-react'
import type { ClawSkill, SkillRisk, SkillStatus } from '@/lib/types'

// ── Tab nav ───────────────────────────────────────────────────────────────────
const TABS = [
  { label: 'Configure', href: '/tools/claw' },
  { label: 'Status',    href: '/tools/claw/status' },
  { label: 'Skills',    href: '/tools/claw/skills' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
const RISK_COLOR: Record<SkillRisk, string>  = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' }
const RISK_BG:    Record<SkillRisk, string>  = {
  low:    'rgba(34,197,94,0.1)',
  medium: 'rgba(245,158,11,0.1)',
  high:   'rgba(239,68,68,0.1)',
}
const RISK_ICON: Record<SkillRisk, React.ReactNode> = {
  low:    <CheckCircle2 size={11} />,
  medium: <AlertTriangle size={11} />,
  high:   <Lock size={11} />,
}

const STATUS_LABEL: Record<SkillStatus, string> = {
  active:           'Active',
  requires_oauth:   'Needs OAuth',
  requires_config:  'Needs config',
  disabled:         'Disabled',
}
const STATUS_COLOR: Record<SkillStatus, string> = {
  active:           '#22c55e',
  requires_oauth:   '#6c63ff',
  requires_config:  '#f59e0b',
  disabled:         '#55556a',
}

const CATEGORY_LABELS: Record<string, string> = {
  research:      'Research',
  code:          'Code & Dev',
  content:       'Content',
  communication: 'Communication',
  finance:       'Finance',
  data:          'Data',
}

function RiskBadge({ risk }: { risk: SkillRisk }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ backgroundColor: RISK_BG[risk], color: RISK_COLOR[risk], border: `1px solid ${RISK_COLOR[risk]}33` }}
    >
      {RISK_ICON[risk]}
      {risk} risk
    </span>
  )
}

function StatusBadge({ status }: { status: SkillStatus }) {
  const color = STATUS_COLOR[status]
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
      style={{ backgroundColor: `${color}1a`, color, border: `1px solid ${color}33` }}
    >
      {status === 'active' ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
      {STATUS_LABEL[status]}
    </span>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ClawSkillsPage() {
  const [skills,   setSkills]   = useState<ClawSkill[]>([])
  const [source,   setSource]   = useState<'gateway' | 'builtin'>('builtin')
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState<string>('all')
  const [disabled, setDisabled] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const raw = localStorage.getItem('nexus:skills:disabled')
      return new Set(raw ? JSON.parse(raw) as string[] : [])
    } catch { return new Set() }
  })

  const fetchSkills = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/claw/skills')
      const data = await res.json() as { skills: ClawSkill[]; source: 'gateway' | 'builtin' }
      setSkills(data.skills ?? [])
      setSource(data.source)
    } catch {
      setSkills([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSkills() }, [fetchSkills])

  function toggleDisabled(id: string) {
    setDisabled(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      try {
        localStorage.setItem('nexus:skills:disabled', JSON.stringify([...next]))
      } catch {}
      return next
    })
  }

  const categories = [...new Set(skills.map(s => s.category))]
  const filtered   = filter === 'all' ? skills : skills.filter(s => s.category === filter)

  const activeCount   = skills.filter(s => s.status === 'active' && !disabled.has(s.id)).length
  const highRiskCount = skills.filter(s => s.risk === 'high').length

  return (
    <div className="p-6 min-h-full" style={{ backgroundColor: '#050508' }}>
      {/* Back nav */}
      <Link
        href="/tools"
        className="inline-flex items-center gap-1.5 text-xs mb-6 no-underline"
        style={{ color: '#9090b0' }}
        onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = '#e8e8f0')}
        onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = '#9090b0')}
      >
        <ArrowLeft size={13} />
        Back to Tools
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: '#1a1a2e', border: '1px solid #24243e' }}
          >
            <Cpu size={20} style={{ color: '#6c63ff' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: '#e8e8f0' }}>OpenClaw</h1>
            <p className="text-sm" style={{ color: '#9090b0' }}>Skill registry &amp; permission audit</p>
          </div>
        </div>
        <button
          onClick={fetchSkills}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
          style={{ backgroundColor: '#1a1a2e', color: loading ? '#55556a' : '#9090b0', border: '1px solid #24243e', cursor: loading ? 'default' : 'pointer' }}
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl" style={{ backgroundColor: '#0d0d14', border: '1px solid #1a1a2e' }}>
        {TABS.map(tab => (
          <Link
            key={tab.href}
            href={tab.href}
            className="flex-1 text-center py-2 text-sm rounded-lg no-underline font-medium transition-all"
            style={
              tab.href === '/tools/claw/skills'
                ? { backgroundColor: '#1a1a2e', color: '#e8e8f0' }
                : { color: '#55556a' }
            }
            onMouseEnter={e => {
              if (tab.href !== '/tools/claw/skills')
                (e.currentTarget as HTMLAnchorElement).style.color = '#9090b0'
            }}
            onMouseLeave={e => {
              if (tab.href !== '/tools/claw/skills')
                (e.currentTarget as HTMLAnchorElement).style.color = '#55556a'
            }}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* Source badge */}
      <div className="flex items-center gap-2 mb-6">
        <div
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
          style={
            source === 'gateway'
              ? { backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e' }
              : { backgroundColor: '#1a1a2e', border: '1px solid #24243e', color: '#9090b0' }
          }
        >
          {source === 'gateway' ? <Wifi size={11} /> : <WifiOff size={11} />}
          {source === 'gateway' ? 'Live from gateway' : 'Built-in registry'}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total skills',    value: skills.length,  color: '#e8e8f0' },
          { label: 'Active & enabled', value: activeCount,   color: '#22c55e' },
          { label: 'High-risk skills', value: highRiskCount, color: '#ef4444' },
        ].map(k => (
          <div
            key={k.label}
            className="rounded-xl p-4"
            style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
          >
            <p className="text-xs mb-1" style={{ color: '#55556a' }}>{k.label}</p>
            <p className="text-2xl font-bold" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Security note */}
      <div
        className="flex items-start gap-3 rounded-xl p-4 mb-6"
        style={{ backgroundColor: 'rgba(108,99,255,0.06)', border: '1px solid rgba(108,99,255,0.2)' }}
      >
        <Shield size={15} style={{ color: '#6c63ff', flexShrink: 0, marginTop: 1 }} />
        <p className="text-xs leading-relaxed" style={{ color: '#9090b0' }}>
          Review each skill's permission scope before enabling. High-risk skills (email, external writes)
          should be audited carefully — agents will use these autonomously. Disabled skills are tracked
          in your browser and can be re-enabled at any time.
        </p>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2 mb-5">
        {['all', ...categories].map(cat => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
            style={
              filter === cat
                ? { backgroundColor: '#6c63ff', color: '#fff', cursor: 'pointer' }
                : { backgroundColor: '#12121e', color: '#9090b0', border: '1px solid #24243e', cursor: 'pointer' }
            }
          >
            {cat === 'all' ? 'All skills' : CATEGORY_LABELS[cat] ?? cat}
          </button>
        ))}
      </div>

      {/* Skills list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={20} className="animate-spin" style={{ color: '#55556a' }} />
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(skill => {
            const isDisabled = disabled.has(skill.id)
            return (
              <div
                key={skill.id}
                className="rounded-xl p-4"
                style={{
                  backgroundColor: '#12121e',
                  border: `1px solid ${isDisabled ? '#1a1a2e' : '#24243e'}`,
                  opacity: isDisabled ? 0.55 : 1,
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>{skill.name}</p>
                      <RiskBadge risk={skill.risk} />
                      <StatusBadge status={isDisabled ? 'disabled' : skill.status} />
                    </div>
                    <p className="text-xs mb-2.5" style={{ color: '#9090b0' }}>{skill.description}</p>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span
                        className="text-xs font-mono px-2 py-0.5 rounded"
                        style={{ backgroundColor: '#0d0d14', border: '1px solid #1a1a2e', color: '#6c63ff' }}
                      >
                        {skill.scope}
                      </span>
                      <span className="text-xs" style={{ color: '#55556a' }}>
                        {CATEGORY_LABELS[skill.category] ?? skill.category}
                      </span>
                      {skill.oauthProvider && (
                        <span className="text-xs" style={{ color: '#55556a' }}>
                          Requires {skill.oauthProvider} OAuth
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: toggle */}
                  <button
                    onClick={() => toggleDisabled(skill.id)}
                    className="shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
                    style={
                      isDisabled
                        ? { backgroundColor: '#1a1a2e', color: '#22c55e', border: '1px solid #24243e', cursor: 'pointer' }
                        : { backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }
                    }
                  >
                    {isDisabled ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                    {isDisabled ? 'Enable' : 'Disable'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
