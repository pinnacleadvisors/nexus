/**
 * Derive approval-request resolution state from the WHOLE message history.
 *
 * Mirrors computeEditPlanResolutions / computeEditSelfResolutions (which live
 * in the chat components). approval-request was the ONE typed block never
 * migrated to history-derived resolution — it relied on an ephemeral
 * per-message `approval_resolutions` React-state field set by handleApproval,
 * which is NOT persisted and NOT re-derived on reload. So the "Provision …"
 * card re-appeared as unresolved after a reload, and re-surfaced in the
 * FloatingActionBar whenever the same approval_id showed up in a later turn.
 *
 * The fix: scan history for the operator's `APPROVAL [<id>]: ...` reply (which
 * IS persisted as a normal user message, just hidden from render) and rebuild
 * the resolution. Survives reloads and re-emits with no new persistence.
 */
import type { ApprovalRequest } from './approval'

export interface ApprovalResolution {
  approvedItemIds: string[]
  deniedItemIds:   string[]
}

/** Minimal message shape both PlatformChat.Message and BusinessChat.Message satisfy. */
export interface ApprovalMsgLike {
  role:               'user' | 'assistant' | 'system'
  content:            string
  approval_requests?: ApprovalRequest[]
}

// Same grammar buildApprovalReply emits:
//   APPROVAL [<id>]: approve 1,2,3,4
//   APPROVAL [<id>]: approve 1,2 (skip 3,4)
//   APPROVAL [<id>]: approve all
//   APPROVAL [<id>]: deny all
const APPROVAL_REPLY_RE = /APPROVAL\s+\[([^\]]+)\]:\s*(.+?)\s*$/m

export function computeApprovalResolutions(messages: ApprovalMsgLike[]): Map<string, ApprovalResolution> {
  // Collect the full item-id set per approval_id from every emitted block, so
  // "approve all" / skipped-id derivation works even if the block was re-emitted.
  const itemsById = new Map<string, string[]>()
  for (const m of messages) {
    for (const r of m.approval_requests ?? []) {
      if (!itemsById.has(r.approval_id)) itemsById.set(r.approval_id, r.items.map(it => it.id))
    }
  }

  const out = new Map<string, ApprovalResolution>()
  for (const m of messages) {
    if (m.role !== 'user') continue
    const match = APPROVAL_REPLY_RE.exec(m.content)
    if (!match) continue
    const approvalId = match[1].trim()
    // Only tag replies against approval blocks the agent actually emitted.
    if (!itemsById.has(approvalId)) continue
    const allIds = itemsById.get(approvalId)!
    const tail = match[2].trim()

    if (/^deny\b/i.test(tail)) {
      out.set(approvalId, { approvedItemIds: [], deniedItemIds: [...allIds] })
      continue
    }
    const approveMatch = /^approve\s+(.+)$/i.exec(tail)
    if (!approveMatch) continue
    // Drop a trailing "(skip 3,4)" annotation — skipped ids are derived below.
    const bodyText = approveMatch[1].replace(/\(skip[^)]*\)/i, '').trim()
    const approvedItemIds = /^all$/i.test(bodyText)
      ? [...allIds]
      : bodyText.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
    const deniedItemIds = allIds.filter(id => !approvedItemIds.includes(id))
    out.set(approvalId, { approvedItemIds, deniedItemIds })
  }
  return out
}
