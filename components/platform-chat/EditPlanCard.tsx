'use client'

/**
 * EditPlanCard — renders an `edit-plan` fenced block from the agent as
 * an inline card with file-level granularity per group.
 *
 * Distinct from ApprovalCard because the visuals are different:
 *   - One row per GROUP (a logical chunk the agent will do in one turn),
 *     not one row per atomic item
 *   - Each row shows: label + file list + est_turns + status (todo / ✓
 *     done / ⏳ in progress)
 *   - Three actions: Approve selected (one or many groups), Continue
 *     (resume the next un-completed approved group), Deny all
 *
 * Reply format reuses the existing `APPROVAL [<plan_id>]: ...` shape so
 * the agent's downstream parsing is unchanged. See lib/chat/edit-plan.ts
 * for the protocol spec.
 */

import { useEffect, useState } from 'react'
import { Check, X, Play, Layers, CheckCircle2, XCircle, FileEdit } from 'lucide-react'
import type { EditPlan } from '@/lib/chat/edit-plan'

export interface EditPlanResolution {
  approvedGroupIds:  string[]
  completedGroupIds: string[]
  /** Set when the operator clicked Deny — the whole plan was dropped. */
  denied?:           boolean
}

interface Props {
  plan:        EditPlan
  /** Aggregated state from prior turns + this turn's metadata. When the
   *  card is purely "ask" (no resolutions yet) pass null. */
  resolution?: EditPlanResolution | null
  /** Called when the operator clicks Approve. The parent translates this
   *  into an `APPROVAL [<plan_id>]: approve g1,g2` user reply. */
  onApprove?:  (approvedGroupIds: string[]) => void
  /** Called when the operator clicks Continue (resume next un-completed
   *  approved group). The parent emits `APPROVAL [<plan_id>]: continue`. */
  onContinue?: () => void
  /** Called on Deny all → `APPROVAL [<plan_id>]: deny all`. */
  onDeny?:     () => void
  disabled?:   boolean
}

export default function EditPlanCard({ plan, resolution, onApprove, onContinue, onDeny, disabled }: Props) {
  // Default every group checked (operator usually approves the whole plan).
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const g of plan.groups) init[g.id] = true
    return init
  })

  useEffect(() => {
    const init: Record<string, boolean> = {}
    for (const g of plan.groups) init[g.id] = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset derived checkbox state when a new edit-plan lands in the same card
    setChecked(init)
  }, [plan.plan_id])

  const approvedSoFar  = new Set(resolution?.approvedGroupIds  ?? [])
  const completedSoFar = new Set(resolution?.completedGroupIds ?? [])
  const denied         = !!resolution?.denied

  // Has the operator approved at least one group already (any turn)?
  const anyApproved  = approvedSoFar.size > 0 && !denied
  // Are there approved groups still waiting to be completed?
  const pendingGroups = plan.groups.filter(g => approvedSoFar.has(g.id) && !completedSoFar.has(g.id))
  const hasPending    = pendingGroups.length > 0
  // The card is "resolved" once every approved group is also completed
  // (or denied). Used to flip the read-only state.
  const fullyResolved = denied || (anyApproved && !hasPending)

  // The selection only matters before the first approval — afterwards
  // we show the locked-in approval state from `resolution`.
  const selectedIds = plan.groups.filter(g => checked[g.id]).map(g => g.id)
  const noneSelected = selectedIds.length === 0
  const allSelected  = selectedIds.length === plan.groups.length

  return (
    <div
      className="rounded-xl mt-3 mb-1"
      style={{
        background:           'linear-gradient(135deg, rgba(99,180,255,0.10), rgba(255,255,255,0.02))',
        border:               '1px solid rgba(99,180,255,0.30)',
        backdropFilter:       'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow:            '0 1px 0 0 rgba(255,255,255,0.06) inset',
      }}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-start gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {denied
          ? <XCircle      size={16} style={{ color: '#ef4444', marginTop: 1 }} />
          : fullyResolved
            ? <CheckCircle2 size={16} style={{ color: '#22c55e', marginTop: 1 }} />
            : <Layers       size={16} style={{ color: '#7eb6ff', marginTop: 1 }} />}
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-[0.14em] mb-0.5" style={{ color: '#7eb6ff' }}>
            {denied
              ? 'Plan denied'
              : fullyResolved
                ? `All ${approvedSoFar.size} approved group${approvedSoFar.size === 1 ? '' : 's'} complete`
                : anyApproved
                  ? `Multi-turn edit · ${completedSoFar.size}/${approvedSoFar.size} groups complete`
                  : 'Multi-turn edit plan — approve to start'}
          </div>
          <div className="text-sm font-medium" style={{ color: '#e8e8f0' }}>{plan.intent}</div>
        </div>
        <div className="text-[10px] font-mono opacity-60 shrink-0" style={{ color: '#9090b0' }}>
          {plan.plan_id.slice(-12)}
        </div>
      </div>

      {/* Group rows */}
      <div className="px-4 py-3 space-y-2.5">
        {plan.groups.map(g => {
          const isCompleted = completedSoFar.has(g.id)
          const isApproved  = approvedSoFar.has(g.id)
          // Lock the checkbox once any approval has been sent — operator can't
          // un-approve a group that's already been kicked off.
          const locked      = anyApproved || fullyResolved
          const isChecked   = locked ? isApproved : !!checked[g.id]
          // Visual state markers
          const status = isCompleted ? 'done' : (isApproved && !isCompleted ? 'in-progress' : 'todo')
          return (
            <div key={g.id} className="text-sm" style={{ color: '#e8e8f0' }}>
              <label className="flex items-start gap-2.5 cursor-pointer" style={{ opacity: locked && !isApproved ? 0.5 : 1 }}>
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={locked || disabled}
                  onChange={e => setChecked(prev => ({ ...prev, [g.id]: e.target.checked }))}
                  className="mt-1 shrink-0"
                  style={{ accentColor: '#6c63ff' }}
                />
                <span className="font-mono text-[11px] mt-0.5 shrink-0 opacity-60">{g.id}.</span>
                <span className="flex-1">{g.label}</span>
                <span className="text-[10px] font-mono opacity-60 shrink-0">
                  ~{g.est_turns}t
                </span>
                {status === 'done'        && <CheckCircle2 size={12} style={{ color: '#22c55e', marginTop: 2 }} />}
                {status === 'in-progress' && <Play         size={12} style={{ color: '#fbbf24', marginTop: 2 }} />}
              </label>
              <div className="ml-7 mt-1 flex flex-wrap gap-1.5">
                {g.files.map(f => (
                  <span
                    key={f}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px]"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#bababd' }}
                  >
                    <FileEdit size={9} /> {f}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Action bar — different actions depending on lifecycle stage */}
      {!fullyResolved && (
        <div
          className="px-4 py-2.5 flex items-center justify-between gap-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <button
            onClick={() => onDeny?.()}
            disabled={disabled}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
            style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}
          >
            <X size={12} /> Deny all
          </button>
          {anyApproved && hasPending ? (
            <button
              onClick={() => onContinue?.()}
              disabled={disabled}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.30), rgba(34,197,94,0.10))', border: '1px solid rgba(34,197,94,0.30)', color: '#e8e8f0' }}
              title={`Resume with group ${pendingGroups[0].id} — "${pendingGroups[0].label}"`}
            >
              <Play size={12} /> Continue (group {pendingGroups[0].id})
            </button>
          ) : (
            <button
              onClick={() => onApprove?.(selectedIds)}
              disabled={disabled || noneSelected}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, rgba(99,180,255,0.30), rgba(99,180,255,0.10))', border: '1px solid rgba(99,180,255,0.30)', color: '#e8e8f0' }}
            >
              <Check size={12} /> {allSelected ? 'Approve all' : noneSelected ? 'Select at least one' : `Approve ${selectedIds.length}/${plan.groups.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
