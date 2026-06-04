'use client'

/**
 * EditSelfCard — renders an `edit-self` fenced block from the agent.
 *
 * Sibling of EditPlanCard but for SELF-modifications (agent proposing
 * edits to its own spec / skill / hook / memory) rather than EXTERNAL
 * edits (agent editing the product codebase across turns).
 *
 * Distinct from EditPlanCard because:
 *   - One row per ITEM (atomic file edit), not per group
 *   - Shows `target` + `target_slug` prominently (agent-spec / skill / etc.)
 *   - Two actions: Approve selected, Deny all (no Continue — edit-self is
 *     one-shot; the /apply route opens a draft PR)
 *   - Indicates the absorbed Continual Harness pattern in the header
 *
 * Reply format reuses `APPROVAL [<plan_id>]: ...` so the chat-side parser
 * is unchanged. See lib/chat/edit-self.ts for the protocol spec.
 */

import { useEffect, useState } from 'react'
import { Check, X, FileEdit, CheckCircle2, XCircle, Wrench, BookOpen, Brain, ShieldCheck } from 'lucide-react'
import type { EditSelfPlan, EditSelfTarget } from '@/lib/chat/edit-self'

export interface EditSelfResolution {
  approvedItemIds: string[]
  /** Set if the operator denied. */
  denied?:         boolean
  /** Set after the /apply route runs — the URL of the draft PR. */
  prUrl?:          string
}

interface Props {
  plan:        EditSelfPlan
  resolution?: EditSelfResolution | null
  onApprove?:  (approvedItemIds: string[]) => void
  onDeny?:     () => void
  disabled?:   boolean
}

const TARGET_ICON: Record<EditSelfTarget, typeof Wrench> = {
  'agent-spec': BookOpen,
  'skill':      Wrench,
  'hook':       ShieldCheck,
  'memory':     Brain,
}

const TARGET_LABEL: Record<EditSelfTarget, string> = {
  'agent-spec': 'Agent spec',
  'skill':      'Skill',
  'hook':       'Hook',
  'memory':     'Memory',
}

export default function EditSelfCard({ plan, resolution, onApprove, onDeny, disabled }: Props) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const it of plan.items) init[it.id] = true
    return init
  })

  // Reset checkboxes when a new plan_id lands in the same card.
  useEffect(() => {
    const init: Record<string, boolean> = {}
    for (const it of plan.items) init[it.id] = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset derived checkbox state when a new plan_id lands in the same card
    setChecked(init)
  }, [plan.plan_id])

  const approvedIds = plan.items.filter(it => checked[it.id]).map(it => it.id)
  const noneSelected = approvedIds.length === 0
  const allSelected  = approvedIds.length === plan.items.length
  const resolved     = !!resolution

  const TargetIcon = TARGET_ICON[plan.target]
  const targetLabel = TARGET_LABEL[plan.target]

  return (
    <div
      className="rounded-xl mt-3 mb-1"
      style={{
        background:           'linear-gradient(135deg, rgba(255,154,108,0.10), rgba(255,255,255,0.02))',
        border:               '1px solid rgba(255,154,108,0.30)',
        backdropFilter:       'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow:            '0 1px 0 0 rgba(255,255,255,0.06) inset',
      }}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-start gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {resolved
          ? (resolution!.denied
              ? <XCircle      size={16} style={{ color: '#ef4444', marginTop: 1 }} />
              : <CheckCircle2 size={16} style={{ color: '#22c55e', marginTop: 1 }} />)
          : <FileEdit size={16} style={{ color: '#ff9a6c', marginTop: 1 }} />
        }
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.14em] mb-0.5 flex items-center gap-1.5" style={{ color: '#ff9a6c' }}>
            <span>Self-modification proposal</span>
            <span style={{ color: '#55556a' }}>·</span>
            <span style={{ color: '#9090b0' }}>Continual Harness pattern</span>
          </div>
          <div className="text-sm font-medium" style={{ color: '#e8e8f0' }}>{plan.intent}</div>
          <div className="text-[11px] mt-1 flex items-center gap-1.5" style={{ color: '#9090b0' }}>
            <TargetIcon size={11} />
            <span>{targetLabel}: <code className="font-mono">{plan.target_slug}</code></span>
          </div>
          {plan.rationale && (
            <div className="text-[11px] mt-1.5 italic" style={{ color: '#9090b0' }}>
              {plan.rationale}
            </div>
          )}
        </div>
        <div className="text-[10px] font-mono opacity-60 shrink-0" style={{ color: '#9090b0' }}>
          {plan.plan_id.slice(-12)}
        </div>
      </div>

      {/* Items */}
      <div className="px-4 py-3 space-y-2">
        {plan.items.map(it => {
          const isApproved = resolved
            ? (resolution!.denied ? false : (resolution!.approvedItemIds.includes(it.id) || resolution!.approvedItemIds.includes('*')))
            : !!checked[it.id]
          return (
            <label
              key={it.id}
              className="flex items-start gap-2.5 cursor-pointer text-sm"
              style={{ color: '#e8e8f0', opacity: resolved ? 0.85 : 1 }}
            >
              <input
                type="checkbox"
                checked={isApproved}
                disabled={resolved || disabled}
                onChange={e => setChecked(prev => ({ ...prev, [it.id]: e.target.checked }))}
                className="mt-1 shrink-0"
                style={{ accentColor: '#ff9a6c' }}
              />
              <span className="font-mono text-[11px] mt-0.5 shrink-0 opacity-60">{it.id}.</span>
              <div className="flex-1 min-w-0">
                <div>{it.label}</div>
                <div className="text-[11px] font-mono mt-0.5 truncate" style={{ color: '#9090b0' }}>
                  {it.file_path}
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: '#9090b0' }}>
                  {it.change_summary}
                </div>
              </div>
              {resolved && !isApproved && !resolution!.denied && (
                <span className="text-[11px] font-mono opacity-50 shrink-0" style={{ color: '#ef4444' }}>skipped</span>
              )}
            </label>
          )
        })}
      </div>

      {/* PR link, if resolved + applied */}
      {resolved && resolution!.prUrl && (
        <div
          className="px-4 py-2 text-[11px] flex items-center gap-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)', color: '#9090b0' }}
        >
          <Check size={12} style={{ color: '#22c55e' }} />
          <span>Draft PR opened:</span>
          <a href={resolution!.prUrl} target="_blank" rel="noreferrer" className="underline truncate" style={{ color: '#a8a3ff' }}>
            {resolution!.prUrl}
          </a>
        </div>
      )}

      {/* Action bar — only when unresolved */}
      {!resolved && (
        <div
          className="px-4 py-2.5 flex items-center justify-end gap-2 flex-wrap"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <button
            onClick={() => onDeny?.()}
            disabled={disabled}
            className="flex items-center gap-1.5 px-3 py-1.5 min-h-[40px] sm:min-h-0 rounded-lg text-xs font-medium disabled:opacity-40"
            style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}
          >
            <X size={12} /> Deny all
          </button>
          <button
            onClick={() => onApprove?.(approvedIds)}
            disabled={disabled || noneSelected}
            className="flex items-center gap-1.5 px-3 py-1.5 min-h-[40px] sm:min-h-0 rounded-lg text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, rgba(255,154,108,0.30), rgba(255,154,108,0.10))', border: '1px solid rgba(255,154,108,0.40)', color: '#e8e8f0' }}
          >
            <Check size={12} /> {allSelected ? 'Approve all' : noneSelected ? 'Select at least one' : `Approve ${approvedIds.length}/${plan.items.length}`}
          </button>
        </div>
      )}
    </div>
  )
}
