'use client'

import { useState } from 'react'
import {
  ExternalLink, ChevronDown, ChevronRight, Play, Trash2,
  Check, X, DollarSign, TrendingUp, Gauge, Loader2, AlertCircle,
} from 'lucide-react'
import type { IdeaCard as IdeaCardType, SavedAutomation } from '@/lib/types'

const AUTOMATIONS_KEY = 'nexus:automations'

function saveAutomation(auto: SavedAutomation) {
  try {
    const raw = localStorage.getItem(AUTOMATIONS_KEY)
    const list: SavedAutomation[] = raw ? JSON.parse(raw) : []
    list.unshift(auto)
    localStorage.setItem(AUTOMATIONS_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
}

interface Props {
  card: IdeaCardType
  onDelete: (id: string) => void
}

export default function IdeaCard({ card, onDelete }: Props) {
  const [showSteps, setShowSteps] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [executeOpen, setExecuteOpen] = useState(false)

  return (
    <div
      className="p-5 rounded-xl border"
      style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}
    >
      {card.mode === 'remodel' && card.inspirationUrl && (
        <div className="mb-3">
          <span className="text-xs uppercase tracking-wide" style={{ color: '#6c63ff' }}>
            Remodel · Inspiration
          </span>
          <a
            href={card.inspirationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 flex items-center gap-1.5 text-sm truncate hover:underline"
            style={{ color: '#e8e8f0' }}
          >
            {card.inspirationUrl}
            <ExternalLink size={12} className="shrink-0" />
          </a>
        </div>
      )}

      <p className="text-sm mb-4" style={{ color: '#e8e8f0' }}>{card.description}</p>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <Stat icon={<DollarSign size={14} />} label="How it makes money" value={card.howItMakesMoney} />
        <Stat icon={<TrendingUp size={14} />} label="Approx. revenue / mo" value={`$${card.approxMonthlyRevenueUsd.toLocaleString()}`} />
        <Stat icon={<DollarSign size={14} />} label="Approx. setup cost" value={`$${card.approxSetupCostUsd.toLocaleString()}`} />
        <Stat icon={<DollarSign size={14} />} label="Approx. monthly cost" value={`$${card.approxMonthlyCostUsd.toLocaleString()}`} />
        <Stat
          icon={<Gauge size={14} />}
          label="Automation"
          value={`${card.automationPercent}%`}
          span="col-span-2"
        />
      </div>

      <div
        className="mb-3 p-2.5 rounded-lg text-xs"
        style={{
          backgroundColor: verdictBg(card.profitableVerdict),
          color: verdictFg(card.profitableVerdict),
        }}
      >
        <span className="font-semibold uppercase tracking-wide mr-1.5">
          {card.profitableVerdict}
        </span>
        {card.profitableReasoning}
      </div>

      <Collapsible
        label={`Steps (${card.steps.length})`}
        open={showSteps}
        onToggle={() => setShowSteps(v => !v)}
      >
        <ul className="space-y-1.5">
          {card.steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-sm" style={{ color: '#e8e8f0' }}>
              <span
                className="mt-0.5 shrink-0 flex items-center justify-center w-4 h-4 rounded"
                style={{
                  backgroundColor: s.automatable ? '#1e3a2e' : '#3a1e1e',
                  color: s.automatable ? '#4ade80' : '#ff7a90',
                }}
                title={s.automatable ? 'Automatable' : 'Manual step'}
              >
                {s.automatable ? <Check size={10} /> : <X size={10} />}
              </span>
              <span className="flex-1">
                {s.title}
                <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#1a1a2e', color: '#9090b0' }}>
                  {s.phase}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Collapsible>

      <Collapsible
        label={`Tools (${card.tools.length})`}
        open={showTools}
        onToggle={() => setShowTools(v => !v)}
      >
        <ul className="space-y-1.5">
          {card.tools.map((t, i) => (
            <li key={i} className="text-sm" style={{ color: '#e8e8f0' }}>
              <span className="font-medium">{t.name}</span>
              <span style={{ color: '#9090b0' }}> — {t.purpose}</span>
              {t.url && (
                <a
                  href={t.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1.5 inline-flex items-center"
                  style={{ color: '#6c63ff' }}
                >
                  <ExternalLink size={12} />
                </a>
              )}
            </li>
          ))}
        </ul>
      </Collapsible>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => setExecuteOpen(true)}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium"
          style={{ backgroundColor: '#6c63ff', color: '#fff' }}
        >
          <Play size={14} />
          Execute
        </button>
        <button
          onClick={() => onDelete(card.id)}
          className="p-2 rounded-lg"
          style={{ backgroundColor: '#1a1a2e', color: '#9090b0' }}
          title="Delete idea"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {executeOpen && (
        <ExecuteModal card={card} onClose={() => setExecuteOpen(false)} />
      )}
    </div>
  )
}

function Stat({
  icon, label, value, span,
}: {
  icon: React.ReactNode
  label: string
  value: string
  span?: string
}) {
  return (
    <div className={span}>
      <div className="flex items-center gap-1.5 mb-0.5 text-xs" style={{ color: '#9090b0' }}>
        {icon}
        {label}
      </div>
      <div className="text-sm font-medium" style={{ color: '#e8e8f0' }}>{value}</div>
    </div>
  )
}

function Collapsible({
  label, open, onToggle, children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="mb-2">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 py-1.5 text-sm font-medium"
        style={{ color: '#e8e8f0' }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {label}
      </button>
      {open && <div className="pl-5 pt-1 pb-2">{children}</div>}
    </div>
  )
}

function verdictBg(v: IdeaCardType['profitableVerdict']) {
  if (v === 'likely') return '#0f2a1c'
  if (v === 'unlikely') return '#2a1116'
  return '#1a1a2e'
}

function verdictFg(v: IdeaCardType['profitableVerdict']) {
  if (v === 'likely') return '#4ade80'
  if (v === 'unlikely') return '#ff7a90'
  return '#9090b0'
}

function ExecuteModal({ card, onClose }: { card: IdeaCardType; onClose: () => void }) {
  const [executeInput, setExecuteInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<SavedAutomation | null>(null)

  async function run() {
    setSubmitting(true)
    setError(null)

    const context = [
      `Mode: ${card.mode}`,
      card.inspirationUrl ? `Inspiration: ${card.inspirationUrl}` : '',
      card.twist ? `Twist: ${card.twist}` : '',
      `How it makes money: ${card.howItMakesMoney}`,
      `Automation target: ${card.automationPercent}%`,
      `Tools: ${card.tools.map(t => t.name).join(', ')}`,
      `Steps:\n${card.steps.map(s => `- [${s.phase}] ${s.title} (${s.automatable ? 'auto' : 'manual'})`).join('\n')}`,
      executeInput.trim() ? `\nExtra instructions from owner: ${executeInput.trim()}` : '',
    ].filter(Boolean).join('\n')

    const res = await fetch('/api/n8n/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: `Build project workflow for idea: ${card.description}`,
        businessContext: context,
      }),
    })

    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error ?? `Request failed (${res.status})`)
      setSubmitting(false)
      return
    }

    const data = await res.json() as {
      workflow: unknown
      checklist: string[]
      explanation: string
      importUrl?: string
    }

    const auto: SavedAutomation = {
      id: crypto.randomUUID(),
      ideaId: card.id,
      name: (data.workflow as { name?: string })?.name ?? `Workflow for ${card.description.slice(0, 40)}`,
      createdAt: new Date().toISOString(),
      workflowJson: JSON.stringify(data.workflow, null, 2),
      checklist: data.checklist ?? [],
      explanation: data.explanation ?? '',
      importFailed: !data.importUrl,
    }
    saveAutomation(auto)
    setDone(auto)
    setSubmitting(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg p-6 rounded-xl border"
        style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}
      >
        <h3 className="text-lg font-semibold mb-1" style={{ color: '#e8e8f0' }}>
          {done ? 'Workflow saved' : 'Execute idea'}
        </h3>
        <p className="text-sm mb-4" style={{ color: '#9090b0' }}>
          {done
            ? 'View and download the n8n workflow JSON from the Automation Library.'
            : 'Add any extra detail on what you want the workflow to look like. Claude will generate an n8n workflow that builds the project, using manual-trigger nodes for steps you need to do yourself.'}
        </p>

        {!done && (
          <>
            <textarea
              value={executeInput}
              onChange={e => setExecuteInput(e.target.value)}
              rows={5}
              placeholder="Optional: add extra detail. E.g. 'Use a Claude managed agent for content writing, Supabase for storage, and a manual trigger for adding API keys.'"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ backgroundColor: '#050508', color: '#e8e8f0', border: '1px solid #24243e' }}
            />

            {error && (
              <div
                className="mt-3 p-2.5 rounded-lg flex items-start gap-2 text-xs"
                style={{ backgroundColor: '#2a1116', color: '#ff7a90', borderLeft: '2px solid #ff4d6d' }}
              >
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <div className="mt-5 flex items-center gap-2 justify-end">
              <button
                onClick={onClose}
                className="px-3 py-2 rounded-lg text-sm"
                style={{ color: '#9090b0' }}
              >
                Cancel
              </button>
              <button
                onClick={run}
                disabled={submitting}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: '#6c63ff', color: '#fff' }}
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                {submitting ? 'Generating…' : 'Generate workflow'}
              </button>
            </div>
          </>
        )}

        {done && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: '#050508', color: '#9090b0' }}>
              {done.explanation}
            </div>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={onClose}
                className="px-3 py-2 rounded-lg text-sm"
                style={{ color: '#9090b0' }}
              >
                Close
              </button>
              <a
                href="/automation-library"
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ backgroundColor: '#6c63ff', color: '#fff' }}
              >
                Go to library
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
