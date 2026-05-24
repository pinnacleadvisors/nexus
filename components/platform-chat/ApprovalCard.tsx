'use client'

/**
 * ApprovalCard — Phase 3 of task_plan-chat.md.
 *
 * Rendered inline within an assistant message bubble when the agent emits
 * an `approval-request` fenced block. Operator sees a card with:
 *   - Title (what the agent wants to do)
 *   - One checkbox per item (default: checked if approved_by_default)
 *   - Approve button (sends the selected subset)
 *   - Deny all button
 *
 * On click, the parent posts a follow-up user message in the canonical
 * APPROVAL [<id>]: ... format that the agent's next turn reads. Buttons
 * are not executable code — the agent retains full control of what runs.
 *
 * Once an approval is sent, the card collapses to a status indicator so
 * historical messages remain meaningful (you can see what you approved).
 */

import { useEffect, useState } from 'react'
import { Check, X, ShieldCheck, CheckCircle2, XCircle, Maximize2 } from 'lucide-react'
import { Drawer } from 'vaul'
import type { ApprovalRequest } from '@/lib/chat/approval'
import { useIsMobile } from '@/lib/hooks/useIsMobile'

interface Props {
  request:    ApprovalRequest
  /** Whether the operator has already sent a reply for this approval_id.
   *  When set, the card renders read-only with the resolution status. */
  resolution?: { approvedItemIds: string[]; deniedItemIds: string[] } | null
  onSubmit?:  (approvedItemIds: string[]) => void
  disabled?:  boolean
}

export default function ApprovalCard({ request, resolution, onSubmit, disabled }: Props) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const it of request.items) init[it.id] = it.approved_by_default !== false
    return init
  })

  // Recompute defaults when a different request lands in the same card.
  useEffect(() => {
    const init: Record<string, boolean> = {}
    for (const it of request.items) init[it.id] = it.approved_by_default !== false
    setChecked(init)
  }, [request.approval_id])

  const approvedIds = request.items.filter(it => checked[it.id]).map(it => it.id)
  const noneSelected = approvedIds.length === 0
  const allSelected  = approvedIds.length === request.items.length

  const resolved = !!resolution

  // Phase 2B of task_plan-collaborative-chat.md — on mobile with multi-item
  // approvals, the inline card is cramped. Auto-open a Vaul bottom-sheet
  // pinned to 92vh so the operator gets full-screen tap-friendly buttons.
  // Operator can swipe down to dismiss → reveals the inline card behind it,
  // can still approve from there. Resolved cards always inline (historical).
  const isMobile = useIsMobile('sm')
  const [sheetOpen, setSheetOpen] = useState(false)
  // Auto-open the sheet exactly once per approval_id — when a new approval
  // lands on a mobile viewport, the operator should see it modally without
  // having to scroll the chat. Re-rendering must not re-open after dismissal.
  const [seenApprovalIds, setSeenApprovalIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!isMobile || resolved) return
    if (request.items.length <= 2) return
    if (seenApprovalIds.has(request.approval_id)) return
    setSheetOpen(true)
    setSeenApprovalIds(prev => new Set(prev).add(request.approval_id))
  }, [isMobile, resolved, request.approval_id, request.items.length, seenApprovalIds])

  const useFullScreen = isMobile && !resolved && request.items.length > 2

  const inlineCard = (
    <div
      className="rounded-xl mt-3 mb-1"
      style={{
        background:           'linear-gradient(135deg, rgba(108,99,255,0.10), rgba(255,255,255,0.02))',
        border:               '1px solid rgba(108,99,255,0.30)',
        backdropFilter:       'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow:            '0 1px 0 0 rgba(255,255,255,0.06) inset',
      }}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-start gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {resolved
          ? (resolution!.approvedItemIds.length > 0
              ? <CheckCircle2 size={16} style={{ color: '#22c55e', marginTop: 1 }} />
              : <XCircle      size={16} style={{ color: '#ef4444', marginTop: 1 }} />)
          : <ShieldCheck size={16} style={{ color: '#a8a3ff', marginTop: 1 }} />
        }
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-[0.14em] mb-0.5" style={{ color: '#a8a3ff' }}>
            {resolved
              ? (resolution!.approvedItemIds.length === request.items.length
                  ? 'Approved (all)'
                  : resolution!.approvedItemIds.length === 0
                    ? 'Denied'
                    : `Approved ${resolution!.approvedItemIds.length}/${request.items.length}`)
              : 'Approval required'}
          </div>
          <div className="text-sm font-medium" style={{ color: '#e8e8f0' }}>{request.title}</div>
        </div>
        <div className="text-[10px] font-mono opacity-60 shrink-0" style={{ color: '#9090b0' }}>
          {request.approval_id.slice(-12)}
        </div>
      </div>

      {/* Items */}
      <div className="px-4 py-3 space-y-2">
        {request.items.map(it => {
          const isApproved = resolved
            ? resolution!.approvedItemIds.includes(it.id)
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
                style={{ accentColor: '#6c63ff' }}
              />
              <span className="font-mono text-[11px] mt-0.5 shrink-0 opacity-60">{it.id}.</span>
              <span className="flex-1">{it.label}</span>
              {resolved && !isApproved && (
                <span className="text-[11px] font-mono opacity-50 shrink-0" style={{ color: '#ef4444' }}>skipped</span>
              )}
            </label>
          )
        })}
      </div>

      {/* Action bar — bigger tap targets on mobile per Phase 2B. */}
      {!resolved && (
        <div
          className="px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          {useFullScreen && (
            <button
              onClick={() => setSheetOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg text-xs font-medium opacity-70 hover:opacity-100"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', color: '#9090b0' }}
            >
              <Maximize2 size={11} /> Expand
            </button>
          )}
          <button
            onClick={() => onSubmit?.([])}
            disabled={disabled}
            className="flex items-center gap-1.5 px-3 py-1.5 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-lg text-xs font-medium disabled:opacity-40"
            style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}
          >
            <X size={12} /> Deny all
          </button>
          <button
            onClick={() => onSubmit?.(approvedIds)}
            disabled={disabled || noneSelected}
            className="flex items-center gap-1.5 px-3 py-1.5 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-lg text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.10))', border: '1px solid rgba(108,99,255,0.30)', color: '#e8e8f0' }}
          >
            <Check size={12} /> {allSelected ? 'Approve all' : noneSelected ? 'Select at least one' : `Approve ${approvedIds.length}/${request.items.length}`}
          </button>
        </div>
      )}
    </div>
  )

  // Default: inline card. On mobile with 3+ items + unresolved, ALSO render a
  // Vaul Drawer that auto-opens once (per approval_id) — operator can swipe
  // down to dismiss and use the inline card behind it.
  if (!useFullScreen) {
    return inlineCard
  }

  return (
    <>
      {inlineCard}
      <Drawer.Root open={sheetOpen} onOpenChange={setSheetOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.6)' }} />
          <Drawer.Content
            className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl outline-none"
            style={{
              background:           'linear-gradient(180deg, rgba(15,15,24,0.98), rgba(8,8,14,0.98))',
              borderTop:            '1px solid rgba(108,99,255,0.30)',
              backdropFilter:       'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              maxHeight:            '92vh',
              minHeight:            '60vh',
              boxShadow:            '0 -10px 32px rgba(0,0,0,0.5)',
            }}
          >
            <div className="mx-auto mt-2 mb-1 h-1.5 w-12 rounded-full" style={{ background: 'rgba(255,255,255,0.18)' }} />
            <Drawer.Title className="sr-only">{request.title}</Drawer.Title>
            <Drawer.Description className="sr-only">Approval card — review and approve or deny items</Drawer.Description>
            <div className="flex-1 overflow-y-auto px-2 pb-4">
              {inlineCard}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  )
}
