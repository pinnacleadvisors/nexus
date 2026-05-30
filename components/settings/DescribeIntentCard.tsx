'use client'

/**
 * DescribeIntentCard — generic "describe what you want, we'll classify + route"
 * card. Lifted from AccountList's DescribeConnectionCard into a reusable shape
 * so the Agents and Skills tabs get the same Connectors-style Create affordance
 * (task_plan-connector-intent.md's describe→classify→route primitive, one card,
 * N call sites).
 *
 * The parent passes an `endpoint` (POST {description} → {ok, kind, message,
 * taskId}) and an optional `onResult` so it can refresh its list / deep-link.
 */

import { useState } from 'react'
import { Loader2, Sparkles, Wand2, CheckCircle2, AlertCircle } from 'lucide-react'

export interface DescribeIntentResult {
  ok:       boolean
  kind?:    string
  name?:    string | null
  slug?:    string | null
  taskId?:  string
  message?: string
  error?:   string
}

export function DescribeIntentCard({
  title, subtitle, placeholder, endpoint, onResult,
}: {
  title:        string
  subtitle:     string
  placeholder:  string
  endpoint:     string
  onResult?:    (result: DescribeIntentResult) => void
}) {
  const [value,  setValue]  = useState('')
  const [busy,   setBusy]   = useState(false)
  const [result, setResult] = useState<DescribeIntentResult | null>(null)

  async function submit() {
    const description = value.trim()
    if (description.length < 4 || busy) return
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ description }),
      })
      const j = (await res.json().catch(() => ({ ok: false, error: 'parse error' }))) as DescribeIntentResult
      setResult(j)
      onResult?.(j)
      if (j.ok) setValue('')
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : 'network error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="p-3.5 flex flex-col gap-2.5"
      style={{
        background:     'linear-gradient(135deg, rgba(108,99,255,0.07), rgba(255,255,255,0.01))',
        backdropFilter: 'blur(28px) saturate(180%)',
        border:         '1px solid rgba(108,99,255,0.20)',
        borderRadius:   '14px',
      }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg, rgba(108,99,255,0.20), rgba(108,99,255,0.04))', border: '1px solid rgba(108,99,255,0.20)' }}
        >
          <Wand2 size={16} style={{ color: '#a8a3ff' }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium" style={{ color: '#e8e8f0' }}>{title}</div>
          <div className="text-[11px] mt-0.5" style={{ color: '#9090b0' }}>{subtitle}</div>
        </div>
      </div>

      <div className="flex items-stretch gap-2 flex-col sm:flex-row">
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !busy) { e.preventDefault(); void submit() } }}
          placeholder={placeholder}
          disabled={busy}
          className="flex-1 rounded-lg px-3 py-2 text-xs"
          style={{ background: 'rgba(5,5,16,0.55)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8e8f0' }}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || value.trim().length < 4}
          className="text-[11px] px-3 py-2 rounded-lg disabled:opacity-50 font-medium inline-flex items-center justify-center gap-1.5"
          style={{ background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.10))', border: '1px solid rgba(108,99,255,0.30)', color: '#e8e8f0' }}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {busy ? 'Thinking…' : 'Create'}
        </button>
      </div>

      {result && (
        <div
          className="flex items-start gap-2 rounded-lg px-3 py-2 text-[11px]"
          style={result.ok
            ? { background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.25)', color: '#bbf7d0' }
            : { background: 'rgba(239,68,68,0.10)',  border: '1px solid rgba(239,68,68,0.25)',  color: '#fecaca' }}
        >
          {result.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <AlertCircle size={13} className="mt-0.5 shrink-0" />}
          <span>{result.message ?? result.error ?? (result.ok ? 'Done.' : 'Something went wrong.')}</span>
        </div>
      )}
    </div>
  )
}
