'use client'

/**
 * LoopForm — body for /settings/loops/new.
 *
 * Collects the Loop declaration (name, optional business, North Star,
 * end-outcome predicate, delegated agent, mode, caps, gates) and POSTs to
 * /api/loops. On success, routes to the new Loop's dashboard.
 *
 * `synthesize` mode reveals explorer/verifier model + review-modality fields
 * (v2 harness synthesis). Defaults to `iterate`.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import type { AgentDefinition } from '@/lib/types'
import type { LoopMode, ReviewModality } from '@/lib/loops/types'
import { panelStyle, FG, MUTED, ACCENT_SOFT } from './shared'

const inputStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: '10px', color: FG, padding: '8px 12px', fontSize: '13px', width: '100%',
}
const labelStyle: CSSProperties = { color: ACCENT_SOFT, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', display: 'block' }

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <div className="text-[11px] mt-1" style={{ color: MUTED }}>{hint}</div>}
    </div>
  )
}

export default function LoopForm() {
  const router = useRouter()
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [businessSlug, setBusinessSlug] = useState('')
  const [northStar, setNorthStar] = useState('')
  const [endOutcome, setEndOutcome] = useState('')
  const [agentSlug, setAgentSlug] = useState('loop-runner')
  const [mode, setMode] = useState<LoopMode>('iterate')
  const [costCap, setCostCap] = useState('5')
  const [iterationCap, setIterationCap] = useState('10')
  const [timeCap, setTimeCap] = useState('')
  const [gates, setGates] = useState('')
  const [explorerModel, setExplorerModel] = useState('')
  const [verifierModel, setVerifierModel] = useState('')
  const [reviewModality, setReviewModality] = useState<ReviewModality>('code')

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/agents/managed', { cache: 'no-store' })
        if (res.ok) {
          const j = (await res.json()) as { agents?: AgentDefinition[] }
          setAgents(j.agents ?? [])
        }
      } catch { /* dropdown falls back to free-typed default */ }
    })()
  }, [])

  async function submit() {
    setErr(null)
    if (!name.trim()) { setErr('Name is required'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/loops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          business_slug: businessSlug.trim() || null,
          north_star_md: northStar,
          end_outcome_md: endOutcome,
          delegated_agent_slug: agentSlug,
          mode,
          cost_cap_usd: costCap,
          iteration_cap: iterationCap,
          time_cap_hours: timeCap,
          approval_gates: gates.split(',').map(s => s.trim()).filter(Boolean),
          ...(mode === 'synthesize' ? { explorer_model: explorerModel, verifier_model: verifierModel, review_modality: reviewModality } : {}),
        }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string }
      if (!j.ok || !j.id) {
        setErr(j.error === 'migration_094_not_applied'
          ? 'Loops schema not applied yet — run migrations 094–096 on Supabase first.'
          : (j.error ?? 'create failed'))
        return
      }
      router.push(`/settings/loops/${j.id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'create failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-5 rounded-xl space-y-4" style={panelStyle}>
      {err && (
        <div className="px-3 py-2 rounded-lg text-[13px]" style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)' }}>{err}</div>
      )}

      <Field label="Name"><input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Ship the audit terminal to production-ready" /></Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Delegated agent">
          <select style={inputStyle} value={agentSlug} onChange={e => setAgentSlug(e.target.value)}>
            {!agents.some(a => a.slug === 'loop-runner') && <option value="loop-runner">loop-runner</option>}
            {agents.map(a => <option key={a.slug} value={a.slug}>{a.slug}</option>)}
          </select>
        </Field>
        <Field label="Business slug" hint="Optional — leave blank for platform-wide loops">
          <input style={inputStyle} value={businessSlug} onChange={e => setBusinessSlug(e.target.value)} placeholder="(none)" />
        </Field>
      </div>

      <Field label="North Star" hint="One paragraph — the outcome this loop drives toward">
        <textarea style={{ ...inputStyle, minHeight: '72px', resize: 'vertical' }} value={northStar} onChange={e => setNorthStar(e.target.value)} />
      </Field>
      <Field label="End-outcome predicate" hint="How you'll know it's done — description + acceptance test">
        <textarea style={{ ...inputStyle, minHeight: '72px', resize: 'vertical' }} value={endOutcome} onChange={e => setEndOutcome(e.target.value)} />
      </Field>

      <Field label="Mode" hint="iterate = drive toward an outcome · synthesize = crystallize a reusable sub-harness for a novel goal">
        <div className="flex gap-2">
          {(['iterate', 'synthesize'] as LoopMode[]).map(m => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className="px-3 py-1.5 rounded-lg text-[13px] font-medium"
              style={mode === m
                ? { color: FG, background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.08))', border: '1px solid rgba(108,99,255,0.30)' }
                : { color: MUTED, background: 'transparent', border: '1px solid rgba(255,255,255,0.10)' }}>
              {m}
            </button>
          ))}
        </div>
      </Field>

      {mode === 'synthesize' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-3 rounded-lg" style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.20)' }}>
          <Field label="Explorer model" hint="cheap/fast — exhaustive search + tests"><input style={inputStyle} value={explorerModel} onChange={e => setExplorerModel(e.target.value)} placeholder="gpt-5.5-codex" /></Field>
          <Field label="Verifier model" hint="smart — judges after tests pass"><input style={inputStyle} value={verifierModel} onChange={e => setVerifierModel(e.target.value)} placeholder="opus" /></Field>
          <Field label="Review modality">
            <select style={inputStyle} value={reviewModality} onChange={e => setReviewModality(e.target.value as ReviewModality)}>
              {(['code', 'text', 'vision', 'audio'] as ReviewModality[]).map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Cost cap (USD)"><input style={inputStyle} value={costCap} onChange={e => setCostCap(e.target.value)} inputMode="decimal" /></Field>
        <Field label="Iteration cap"><input style={inputStyle} value={iterationCap} onChange={e => setIterationCap(e.target.value)} inputMode="numeric" /></Field>
        <Field label="Time cap (hours)" hint="Optional"><input style={inputStyle} value={timeCap} onChange={e => setTimeCap(e.target.value)} inputMode="decimal" placeholder="(none)" /></Field>
      </div>

      <Field label="Approval gates" hint="Comma-separated scope keys that need operator OK (e.g. deploy_to_prod)">
        <input style={inputStyle} value={gates} onChange={e => setGates(e.target.value)} placeholder="deploy_to_prod, niche_pick" />
      </Field>

      <div className="flex justify-end">
        <button onClick={submit} disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold disabled:opacity-40"
          style={{ color: FG, background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.10))', border: '1px solid rgba(108,99,255,0.30)' }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Create Loop
        </button>
      </div>
    </div>
  )
}
