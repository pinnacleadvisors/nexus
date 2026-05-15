'use client'

/**
 * FloatingActionBar — the always-visible "current action" row that sits
 * just above the chat input, mirroring Claude Code Desktop's UX.
 *
 * Why: with edit-plan multi-turn flows, the inline card that needs a
 * Continue click can scroll out of view as the agent works. Operator
 * shouldn't have to scroll up to the card. This bar surfaces the same
 * action right above where they're already typing.
 *
 * Hide conditions:
 *   - No action pending (idle chat)
 *   - busy === true (turn in flight — bar reappears after busy flips)
 *
 * The inline ApprovalCard / EditPlanCard buttons stay too — they offer
 * fine-grained control (per-group checkboxes, per-item approval) that
 * doesn't fit a compact bar. The bar is the convenience surface for
 * the "approve all" / "continue" default case.
 */

import { Check, X, Play, Layers, ShieldCheck, ArrowUp, FileEdit } from 'lucide-react'
import type { ChatAction } from '@/lib/chat/action-bar'

interface Props {
  action:               ChatAction
  disabled?:            boolean
  /** Approve-all flow for approval-request and edit-plan-approve.
   *  Passes the full set of item / group ids as approved. */
  onApproveAll?:        () => void
  /** Continue flow for edit-plan-continue (the next un-completed group). */
  onContinue?:          () => void
  /** Deny / cancel for whichever action is current. */
  onDeny?:              () => void
  /** Scroll the inline card into view — useful when operator wants to
   *  see the per-group / per-item breakdown before deciding. */
  onScrollToCard?:      () => void
}

export default function FloatingActionBar({ action, disabled, onApproveAll, onContinue, onDeny, onScrollToCard }: Props) {
  if (action.kind === 'edit-plan-continue') {
    return (
      <Bar
        accent="emerald"
        icon={<Play size={13} />}
        label={
          <>
            <span className="opacity-70">Next:</span>{' '}
            <span className="font-medium">{action.nextGroupId} — {action.nextGroupLabel}</span>{' '}
            <span className="opacity-60">·</span>{' '}
            <FilesPill files={action.nextGroupFiles} />
          </>
        }
        primary={{ text: `Continue (${action.nextGroupId})`, icon: <Play size={12} />, onClick: onContinue }}
        secondary={{ text: 'Deny', icon: <X size={12} />, onClick: onDeny, danger: true }}
        onScrollToCard={onScrollToCard}
        disabled={disabled}
      />
    )
  }
  if (action.kind === 'edit-plan-approve') {
    return (
      <Bar
        accent="blue"
        icon={<Layers size={13} />}
        label={
          <>
            <span className="opacity-70">Multi-turn edit plan ·</span>{' '}
            <span className="font-medium">{action.plan.intent}</span>{' '}
            <span className="opacity-60">({action.plan.groups.length} group{action.plan.groups.length === 1 ? '' : 's'})</span>
          </>
        }
        primary={{ text: 'Approve all', icon: <Check size={12} />, onClick: onApproveAll }}
        secondary={{ text: 'Deny', icon: <X size={12} />, onClick: onDeny, danger: true }}
        onScrollToCard={onScrollToCard}
        disabled={disabled}
      />
    )
  }
  // approval-request
  return (
    <Bar
      accent="purple"
      icon={<ShieldCheck size={13} />}
      label={
        <>
          <span className="opacity-70">Approval required ·</span>{' '}
          <span className="font-medium">{action.request.title}</span>{' '}
          <span className="opacity-60">({action.request.items.length} item{action.request.items.length === 1 ? '' : 's'})</span>
        </>
      }
      primary={{ text: 'Approve all', icon: <Check size={12} />, onClick: onApproveAll }}
      secondary={{ text: 'Deny all', icon: <X size={12} />, onClick: onDeny, danger: true }}
      onScrollToCard={onScrollToCard}
      disabled={disabled}
    />
  )
}

type Accent = 'emerald' | 'blue' | 'purple'

interface BarProps {
  accent:          Accent
  icon:            React.ReactNode
  label:           React.ReactNode
  primary:         { text: string; icon: React.ReactNode; onClick?: () => void }
  secondary:       { text: string; icon: React.ReactNode; onClick?: () => void; danger?: boolean }
  onScrollToCard?: () => void
  disabled?:       boolean
}

function Bar({ accent, icon, label, primary, secondary, onScrollToCard, disabled }: BarProps) {
  const tone = accent === 'emerald'
    ? { bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.35)',  fg: '#86efac', primaryBg: 'linear-gradient(135deg, rgba(34,197,94,0.35), rgba(34,197,94,0.10))' }
    : accent === 'blue'
      ? { bg: 'rgba(99,180,255,0.10)', border: 'rgba(99,180,255,0.35)', fg: '#7eb6ff', primaryBg: 'linear-gradient(135deg, rgba(99,180,255,0.35), rgba(99,180,255,0.10))' }
      : { bg: 'rgba(108,99,255,0.10)', border: 'rgba(108,99,255,0.30)', fg: '#a8a3ff', primaryBg: 'linear-gradient(135deg, rgba(108,99,255,0.35), rgba(108,99,255,0.10))' }
  return (
    <div
      className="mx-4 mb-2 rounded-xl px-3 py-2 flex items-center gap-2 text-xs"
      style={{
        background:           tone.bg,
        border:               `1px solid ${tone.border}`,
        backdropFilter:       'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow:            '0 1px 0 0 rgba(255,255,255,0.06) inset',
        color:                '#e8e8f0',
      }}
    >
      <span className="shrink-0" style={{ color: tone.fg }}>{icon}</span>
      <div className="flex-1 min-w-0 truncate">{label}</div>
      {onScrollToCard && (
        <button
          onClick={onScrollToCard}
          disabled={disabled}
          className="text-[10px] underline opacity-70 hover:opacity-100 shrink-0"
          style={{ color: tone.fg }}
          title="Scroll to the inline card for per-item options"
        >
          <ArrowUp size={9} className="inline -mt-0.5" /> Details
        </button>
      )}
      <button
        onClick={secondary.onClick}
        disabled={disabled}
        className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium disabled:opacity-40 shrink-0"
        style={
          secondary.danger
            ? { background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }
            : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#bababd' }
        }
      >
        {secondary.icon} {secondary.text}
      </button>
      <button
        onClick={primary.onClick}
        disabled={disabled}
        className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold disabled:opacity-40 shrink-0"
        style={{ background: tone.primaryBg, border: `1px solid ${tone.border}`, color: '#e8e8f0' }}
      >
        {primary.icon} {primary.text}
      </button>
    </div>
  )
}

/**
 * Compact file-list pill — first 2 files visible, "+N more" if more. Keeps
 * the bar single-line even on big edit groups. Memoless because the list
 * stays tiny.
 */
function FilesPill({ files }: { files: string[] }) {
  if (files.length === 0) return null
  const visible  = files.slice(0, 2)
  const overflow = files.length - visible.length
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {visible.map(f => (
        <span
          key={f}
          className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded font-mono text-[10px]"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#bababd' }}
        >
          <FileEdit size={8} /> {basename(f)}
        </span>
      ))}
      {overflow > 0 && (
        <span className="font-mono text-[10px] opacity-60">+{overflow}</span>
      )}
    </span>
  )
}

function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}
