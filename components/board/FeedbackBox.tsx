'use client'

import { useState } from 'react'
import { MessageSquarePlus, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

interface Props {
  cardId?: string
  agentSlug?: string
  artifactUrl?: string
  /** Called after a successful submit so parent can close/reset UI */
  onSubmitted?: (feedbackId: string | null) => void
}

/**
 * Review-node feedback input. Posts to /api/workflow-feedback; the
 * workflow-optimizer managed agent picks unresolved rows off the queue and
 * proposes changes to the referenced agent.
 */
export default function FeedbackBox({ cardId, agentSlug, artifactUrl, onSubmitted }: Props) {
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'submitting' | 'ok' | 'err'>('idle')
  const [errMsg, setErrMsg] = useState<string | null>(null)

  async function submit() {
    const feedback = text.trim()
    if (!feedback) return
    setState('submitting')
    setErrMsg(null)
    try {
      const res = await fetch('/api/workflow-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, agentSlug, artifactUrl, feedback }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setState('err')
        setErrMsg(json?.error ?? 'Failed to submit feedback')
        return
      }
      setState('ok')
      setText('')
      onSubmitted?.(json?.feedbackId ?? null)
    } catch (err) {
      setState('err')
      setErrMsg(err instanceof Error ? err.message : 'Network error')
    }
  }

  return (
    <div className="px-5 pb-3">
      <label
        className="flex items-center gap-2 text-xs font-semibold mb-2"
        style={{ color: '#9090b0' }}
      >
        <MessageSquarePlus size={12} />
        Quality feedback — trains the optimizer
      </label>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="What was wrong with this output? The workflow-optimizer agent will propose a change to the producing agent."
        rows={3}
        disabled={state === 'submitting'}
        className="w-full rounded-xl px-3 py-2.5 text-sm resize-none outline-none"
        style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#e8e8f0' }}
        onFocus={e => ((e.currentTarget as HTMLTextAreaElement).style.borderColor = '#6c63ff')}
        onBlur={e  => ((e.currentTarget as HTMLTextAreaElement).style.borderColor = '#24243e')}
      />

      <div className="flex items-center justify-between mt-2">
        <div className="text-xs">
          {state === 'ok' && (
            <span className="flex items-center gap-1.5" style={{ color: '#22c55e' }}>
              <CheckCircle2 size={12} /> Queued for the workflow-optimizer
            </span>
          )}
          {state === 'err' && (
            <span className="flex items-center gap-1.5" style={{ color: '#f59e0b' }}>
              <AlertCircle size={12} /> {errMsg ?? 'Failed'}
            </span>
          )}
        </div>

        <button
          onClick={submit}
          disabled={!text.trim() || state === 'submitting'}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={
            text.trim() && state !== 'submitting'
              ? { backgroundColor: '#6c63ff', color: '#fff', cursor: 'pointer' }
              : { backgroundColor: '#1a1a2e', color: '#55556a', cursor: 'not-allowed' }
          }
        >
          {state === 'submitting'
            ? <Loader2 size={12} className="animate-spin" />
            : <MessageSquarePlus size={12} />}
          {state === 'submitting' ? 'Submitting…' : 'Send to optimizer'}
        </button>
      </div>
    </div>
  )
}
